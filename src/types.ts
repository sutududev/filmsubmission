import type { Context } from 'hono'

export type Bindings = {
  DB: D1Database
  R2?: R2Bucket
  ACCESS_CODE?: string
}

export type AppContext = Context<{ Bindings: Bindings }>
