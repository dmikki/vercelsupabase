import {createHmac,timingSafeEqual} from 'node:crypto'
import type {CostEstimate} from './change-request-cost'
const signature=(key:string,payload:string)=>createHmac('sha256',key).update(`change-estimate:${payload}`).digest('hex')
export function signCostEstimate(key:string,user:string,title:string,description:string,estimate:CostEstimate,now=Date.now()) {
  const payload=Buffer.from(JSON.stringify({user,title,description,expires:now+900000,estimate})).toString('base64url')
  return `${payload}.${signature(key,payload)}`
}
export function verifyCostEstimate(key:string,token:unknown,user:string,title:string,description:string,estimate:CostEstimate,now=Date.now()) {
  if(typeof token!=='string'||token.length>40000) throw Error('Please get a fresh estimate.')
  const [payload,sig,...extra]=token.split('.')
  if(extra.length||!/^[a-f0-9]{64}$/.test(sig||'')||!timingSafeEqual(Buffer.from(sig),Buffer.from(signature(key,payload)))) throw Error('Please get a fresh estimate.')
  const data=JSON.parse(Buffer.from(payload,'base64url').toString())
  if(data.user!==user||data.title!==title||data.description!==description||data.expires<now||JSON.stringify(data.estimate)!==JSON.stringify(estimate)) throw Error('The request or pricing changed. Please get a fresh estimate.')
  return estimate
}
