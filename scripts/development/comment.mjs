import { api } from './github.mjs'

const number = Number(process.env.PR_NUMBER)
if (!Number.isSafeInteger(number) || number < 1) throw new Error('Invalid PR')
if (!process.env.COMMENT) throw new Error('COMMENT is required')
await api(`/issues/${number}/comments`, 'POST', { body: process.env.COMMENT })
