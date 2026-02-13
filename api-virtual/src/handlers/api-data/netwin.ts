import type { HandlerContext, HandlerResult } from '../types';

export default function handler(ctx: HandlerContext): HandlerResult {
  const dateIn = ctx.query.date_in as string | undefined;
  const dateOut = ctx.query.date_out as string | undefined;
  const groupBy = (ctx.query.group_by as string | undefined) ?? 'vertical';
  const chain = ctx.query.chain as string | undefined;
  const playerId = ctx.query.player_id as string | undefined;

  return {
    status: 200,
    body: {
      time_range: {
        start: dateIn ?? null,
        end: dateOut ?? null
      },
      filters: {
        chain: chain ?? null,
        player_id: playerId ? Number(playerId) : null
      },
      data: [
        {
          group_key: groupBy,
          group_by: groupBy,
          coin_in: 1000,
          coin_out: 800,
          netwin: 200,
          operation_count: 12
        }
      ]
    }
  };
}
