import { sql, type Kysely, type RawBuilder, type Transaction } from 'kysely';
import type { DB } from './generated/schema';
import { RPC_SPECS, type RpcArgs, type RpcName, type RpcResult } from './generated/rpc';

type Executor = Kysely<DB> | Transaction<DB>;
type ArgSpec = readonly [name: string, cast: string, optional: boolean];
type ReturnShape = 'void' | 'scalar' | 'row' | 'setof';

function bindArgument(name: string, cast: string, value: unknown): RawBuilder<unknown> {
  const base = /^(json|jsonb)(\[\])?$/.test(cast) ? JSON.stringify(value) : value;
  return sql`${sql.ref(name)} => ${base}::${sql.raw(cast)}`;
}

/** Named-notation call keeps overload resolution explicit and argument order free. */
export function buildRpcStatement(name: RpcName, args: RpcArgs<RpcName>): RawBuilder<unknown> {
  const spec = RPC_SPECS[name] as { args: readonly ArgSpec[] };
  const bindings = spec.args.flatMap(([argument, cast, optional]) => {
    const value = (args as Record<string, unknown>)[argument];
    if (value === undefined) {
      if (optional) return [];
      throw new Error(`[db] ${name} 缺少参数 ${argument}`);
    }
    return [bindArgument(argument, cast, value)];
  });
  return sql`select * from ${sql.ref(`public.${name}`)}(${sql.join(bindings, sql`, `)})`;
}

export async function executeRpc<N extends RpcName>(
  executor: Executor,
  name: N,
  args: RpcArgs<N>,
): Promise<RpcResult<N>> {
  const result = await buildRpcStatement(name, args).execute(executor);
  const shape = (RPC_SPECS[name] as { returns: ReturnShape }).returns;
  const rows = result.rows as Record<string, unknown>[];
  if (shape === 'void') return null as RpcResult<N>;
  if (shape === 'setof') return rows as RpcResult<N>;
  const row = rows[0] ?? null;
  if (shape === 'row') return row as RpcResult<N>;
  const values = row ? Object.values(row) : [];
  return (values[0] ?? null) as RpcResult<N>;
}
