import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { admin, anonymous, cleanup, createUser, denied, newId } from './support.mjs'

let alice
let bob

before(async () => {
  alice = await createUser('alice')
  bob = await createUser('bob')
})
after(cleanup)

test('signing up creates a profile through the database trigger', async () => {
  const { data, error } = await admin.from('profiles').select('id,full_name').eq('id', alice.id).single()
  assert.equal(error, null)
  assert.equal(data.full_name, 'Integration alice')
})

test('users read and update only their own profile', async () => {
  const own = await alice.client.from('profiles').select('id')
  assert.deepEqual(own.data.map(row => row.id), [alice.id])
  const updated = await alice.client.from('profiles').update({ company_name: 'Acme' }).eq('id', alice.id).select('id,company_name')
  assert.equal(updated.data?.[0]?.company_name, 'Acme')
  const foreign = await alice.client.from('profiles').update({ company_name: 'Hacked' }).eq('id', bob.id).select('id')
  assert.equal(foreign.data?.length ?? 0, 0)
  const check = await admin.from('profiles').select('company_name').eq('id', bob.id).single()
  assert.notEqual(check.data.company_name, 'Hacked')
  const forged = await alice.client.from('profiles').insert({ id: bob.id, full_name: 'Forged' })
  assert.ok(forged.error, 'inserting a profile for another user must fail')
})

test('anonymous visitors cannot read private tables', async () => {
  const visitor = anonymous()
  for (const table of ['profiles', 'change_requests', 'change_request_attachments', 'development_spending_policy']) {
    assert.ok(denied(await visitor.from(table).select('*')), `${table} must not be readable anonymously`)
  }
})

test('change requests are private, validated, idempotent and rate limited', async () => {
  const id = newId()
  const submit = (client, request = id, title = 'Add a welcome heading') => client.rpc('submit_change_request', { request_id: request, request_title: title, request_description: 'Add a welcome heading above the profile form.' })
  assert.equal((await submit(alice.client)).error, null)
  assert.equal((await submit(alice.client)).error, null, 'resubmitting the same request is idempotent')
  assert.ok((await submit(bob.client)).error, "another user cannot reuse a request id")
  assert.ok((await submit(anonymous())).error, 'anonymous submission must fail')
  assert.equal((await alice.client.from('change_requests').select('id')).data.length, 1)
  assert.equal((await bob.client.from('change_requests').select('id')).data.length, 0)
  assert.ok((await alice.client.from('change_requests').insert({ id: newId(), user_id: alice.id, title: 'Direct insert', description: 'Direct inserts bypass the quota and must fail.' })).error)
  assert.ok((await alice.client.from('change_requests').update({ status: 'submitted' }).eq('id', id)).error)
  assert.ok((await submit(alice.client, newId(), 'Hi')).error, 'short titles are rejected')
  for (let i = 0; i < 4; i++) assert.equal((await submit(alice.client, newId())).error, null)
  const limited = await submit(alice.client, newId())
  assert.match(limited.error?.message || '', /Daily request limit/)
})

test('attachment metadata is private and its reservation function is server-only', async () => {
  const reserve = (client, actor) => client.rpc('reserve_change_attachment', { attachment_id: newId(), actor, draft_id: newId(), file_name: 'a.txt', file_mime: 'text/plain', file_size: 10, file_path: `${actor}/${newId()}.txt`, file_hash: 'a'.repeat(64) })
  assert.ok((await reserve(alice.client, alice.id)).error, 'authenticated users cannot call the reservation function')
  assert.ok((await reserve(anonymous(), alice.id)).error, 'anonymous users cannot call the reservation function')
  assert.equal((await reserve(admin, bob.id)).error, null)
  assert.equal((await alice.client.from('change_request_attachments').select('id')).data.length, 0)
  assert.equal((await bob.client.from('change_request_attachments').select('id')).data.length, 1)
})

test('storage buckets are private and scoped to the uploader', async () => {
  const buckets = await admin.storage.listBuckets()
  for (const bucket of buckets.data.filter(b => ['avatars', 'change-request-attachments'].includes(b.id))) assert.equal(bucket.public, false, `${bucket.id} must be private`)
  const png = new Blob([Uint8Array.from([137, 80, 78, 71])], { type: 'image/png' })
  assert.equal((await alice.client.storage.from('avatars').upload(`${alice.id}/avatar.png`, png)).error, null)
  assert.ok((await alice.client.storage.from('avatars').upload(`${bob.id}/avatar.png`, png)).error, 'uploads to another user folder must fail')
  const file = new Blob(['private'], { type: 'text/plain' })
  assert.equal((await admin.storage.from('change-request-attachments').upload(`${bob.id}/note.txt`, file)).error, null)
  assert.ok((await alice.client.storage.from('change-request-attachments').download(`${bob.id}/note.txt`)).error, 'attachment objects are not readable by other users')
  assert.ok((await anonymous().storage.from('avatars').upload(`${alice.id}/anonymous.png`, png)).error, 'anonymous uploads must fail')
  assert.ok((await anonymous().storage.from('change-request-attachments').download(`${bob.id}/note.txt`)).error, 'attachments are not readable anonymously')
})
