-- migrate:no-transaction
-- Claim lookups filter queued runs first, then expired leases. Partial indexes
-- keep both paths independent of total run history.
create index concurrently if not exists agent_claim_queued
  on public.agent_runs (created_at)
  where status = 'queued'
    and checkpoint->>'version' = '2'
    and checkpoint#>>'{durable,engine}' = 'pi-durable/1.3.0';

create index concurrently if not exists agent_claim_expired
  on public.agent_runs (lease_until, created_at)
  where status in ('running', 'cancelling')
    and checkpoint->>'version' = '2'
    and checkpoint#>>'{durable,engine}' = 'pi-durable/1.3.0';
