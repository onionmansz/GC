-- Derived balances. security_invoker makes the views obey the caller's RLS.

create view public.card_balances with (security_invoker = true) as
select c.id                                  as card_id,
       c.household_id,
       c.merchant_id,
       coalesce(sum(t.amount_cents), 0)::bigint as balance_cents,
       max(t.created_at)                     as last_activity_at
from public.cards c
left join public.transactions t on t.card_id = c.id
group by c.id;

create view public.merchant_summaries with (security_invoker = true) as
select m.id                                                          as merchant_id,
       m.household_id,
       m.name,
       m.category,
       m.color,
       m.balance_check_url,
       count(c.id) filter (where not c.archived)                     as active_card_count,
       coalesce(sum(b.balance_cents) filter (where not c.archived), 0)::bigint
                                                                     as total_balance_cents
from public.merchants m
left join public.cards c         on c.merchant_id = m.id
left join public.card_balances b on b.card_id = c.id
group by m.id;
