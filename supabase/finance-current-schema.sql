


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."capital_category" AS ENUM (
    'productive',
    'intellectual',
    'social',
    'spiritual',
    'physical'
);


ALTER TYPE "public"."capital_category" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_rules"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
    matched rules%rowtype;
    sp income_splits%rowtype;
    extra numeric;
begin
    if new.dedupe_hash like '%:split' then
        return new;
    end if;

    select r.* into matched
    from rules r
    where r.active
      and (r.account_id is null or r.account_id = new.account_id)
      and (r.direction is null or r.direction = new.direction)
      and coalesce(new.counterparty, '') || ' ' || coalesce(new.description, '') ~* r.pattern
    order by r.priority
    limit 1;

    if found then
        new.type := matched.type;
        new.category_id := matched.category_id;
        new.matched_rule_id := matched.id;
        new.needs_review := matched.needs_review;
    else
        new.type := case new.direction when 'in' then 'income' else 'expense' end;
        new.category_id := null;
        if new.direction = 'in' then
            select id into new.category_id from categories where name = 'Other';
        end if;
        new.matched_rule_id := null;
        new.needs_review := true;
    end if;

    if new.direction = 'in' then
        select s.* into sp
        from income_splits s
        where s.active
          and new.amount > s.base_amount
          and coalesce(new.counterparty, '') || ' ' || coalesce(new.description, '') ~* s.pattern
        order by length(s.pattern) desc
        limit 1;

        if found then
            extra := new.amount - sp.base_amount;
            insert into transactions (
                account_id, occurred_at, direction, amount, type, counterparty,
                description, source, raw_text, dedupe_hash, needs_review
            ) values (
                new.account_id, new.occurred_at, 'in', extra, sp.remainder_type, new.counterparty,
                coalesce(new.description, '') || ' [parte ' || sp.remainder_type || ']',
                new.source, new.raw_text, new.dedupe_hash || ':split', false
            );
            new.amount := sp.base_amount;
            new.type := sp.base_type;
            if sp.base_type <> 'income' then
                new.category_id := null;
            end if;
            new.matched_rule_id := null;
            new.needs_review := false;
        end if;
    end if;

    return new;
end;
$$;


ALTER FUNCTION "public"."apply_rules"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "occurred_at" timestamp with time zone NOT NULL,
    "direction" "text" NOT NULL,
    "amount" numeric(14,2) NOT NULL,
    "type" "text",
    "category_id" "uuid",
    "counterparty" "text",
    "description" "text",
    "source" "text" NOT NULL,
    "raw_text" "text",
    "dedupe_hash" "text" NOT NULL,
    "needs_review" boolean DEFAULT false NOT NULL,
    "matched_rule_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "paired_with" "uuid",
    "label" "text",
    "original_amount" numeric,
    CONSTRAINT "transactions_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "transactions_direction_check" CHECK (("direction" = ANY (ARRAY['in'::"text", 'out'::"text"]))),
    CONSTRAINT "transactions_source_check" CHECK (("source" = ANY (ARRAY['email'::"text", 'notification'::"text", 'statement'::"text", 'manual'::"text"]))),
    CONSTRAINT "transactions_type_check" CHECK (("type" = ANY (ARRAY['income'::"text", 'expense'::"text", 'savings'::"text", 'savings_withdrawal'::"text", 'internal_transfer'::"text", 'card_payment'::"text", 'sponsorship'::"text", 'interest'::"text", 'debt_repayment'::"text", 'family_savings'::"text", 'pass_through'::"text"])))
);


ALTER TABLE "public"."transactions" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_pair_candidate"("t" "public"."transactions") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
    select t.type = 'internal_transfer'
        or (t.needs_review and t.type in ('income', 'expense'))
        or (t.type = 'expense' and t.matched_rule_id in (select id from rules where priority = 99));
$$;


ALTER FUNCTION "public"."is_pair_candidate"("t" "public"."transactions") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reapply_rules"() RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
    updated integer;
begin
    update transactions t
    set type = r.type,
        category_id = r.category_id,
        matched_rule_id = r.id,
        needs_review = false
    from (
        select t2.id as tid,
               (select r2.id
                from rules r2
                where r2.active
                  and (r2.account_id is null or r2.account_id = t2.account_id)
                  and (r2.direction is null or r2.direction = t2.direction)
                  and coalesce(t2.counterparty, '') || ' ' || coalesce(t2.description, '') ~* r2.pattern
                order by r2.priority
                limit 1) as rid
        from transactions t2
        where t2.needs_review
    ) m
    join rules r on r.id = m.rid
    where t.id = m.tid;

    get diagnostics updated = row_count;
    return updated;
end;
$$;


ALTER FUNCTION "public"."reapply_rules"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end $$;


ALTER FUNCTION "public"."touch_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_confirm_partner"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
    if old.needs_review and not new.needs_review and new.type = 'internal_transfer' and new.paired_with is not null then
        update transactions
        set needs_review = false, type = 'internal_transfer', category_id = null
        where id = new.paired_with and needs_review;
    end if;
    return null;
end;
$$;


ALTER FUNCTION "public"."trg_confirm_partner"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_pair_after_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
    perform try_pair_transaction(new.id);
    return null;
end;
$$;


ALTER FUNCTION "public"."trg_pair_after_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."try_pair_transaction"("n_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
    n transactions%rowtype;
    c transactions%rowtype;
    n_certain boolean;
    c_certain boolean;
    confirmed boolean;
begin
    select * into n from transactions where id = n_id;
    if not found or n.paired_with is not null or n.dedupe_hash like '%:split' then
        return;
    end if;
    if not is_pair_candidate(n) then
        return;
    end if;

    select t.* into c
    from transactions t
    where t.id <> n.id
      and t.paired_with is null
      and t.account_id <> n.account_id
      and t.direction <> n.direction
      and t.amount = n.amount
      and abs(extract(epoch from (t.occurred_at - n.occurred_at))) <= 900
      and t.dedupe_hash not like '%:split'
      and is_pair_candidate(t)
    order by abs(extract(epoch from (t.occurred_at - n.occurred_at)))
    limit 1;
    if not found then
        return;
    end if;

    n_certain := n.type = 'internal_transfer' and not n.needs_review;
    c_certain := c.type = 'internal_transfer' and not c.needs_review;
    confirmed := n_certain or c_certain;

    update transactions
    set type = 'internal_transfer', paired_with = c.id, needs_review = not confirmed,
        category_id = case when n_certain then category_id else null end,
        matched_rule_id = case when n_certain then matched_rule_id else null end
    where id = n.id;

    update transactions
    set type = 'internal_transfer', paired_with = n.id, needs_review = not confirmed,
        category_id = case when c_certain then category_id else null end,
        matched_rule_id = case when c_certain then matched_rule_id else null end
    where id = c.id;
end;
$$;


ALTER FUNCTION "public"."try_pair_transaction"("n_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "role" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "statement_day" smallint,
    CONSTRAINT "accounts_role_check" CHECK (("role" = ANY (ARRAY['operating'::"text", 'credit'::"text", 'savings'::"text"]))),
    CONSTRAINT "accounts_statement_day_check" CHECK ((("statement_day" >= 1) AND ("statement_day" <= 31)))
);


ALTER TABLE "public"."accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_secrets" (
    "key" "text" NOT NULL,
    "value" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."app_secrets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."budget_split" (
    "id" boolean DEFAULT true NOT NULL,
    "needs_pct" numeric(5,2) DEFAULT 50.00 NOT NULL,
    "wants_pct" numeric(5,2) DEFAULT 30.00 NOT NULL,
    "savings_pct" numeric(5,2) DEFAULT 20.00 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "income_cutoff_day" smallint DEFAULT 25,
    "tracking_start" "date" DEFAULT '2026-09-01'::"date" NOT NULL,
    "savings_baseline" numeric(14,2) DEFAULT 0 NOT NULL,
    "global_savings_target" numeric(14,2) DEFAULT 0 NOT NULL,
    "savings_goals" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "baseline_accounts" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    CONSTRAINT "budget_split_id_check" CHECK ("id"),
    CONSTRAINT "budget_split_income_cutoff_day_check" CHECK ((("income_cutoff_day" >= 1) AND ("income_cutoff_day" <= 31))),
    CONSTRAINT "budget_split_sums_to_100" CHECK (((("needs_pct" + "wants_pct") + "savings_pct") = 100.00))
);


ALTER TABLE "public"."budget_split" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "bucket" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "categories_bucket_check" CHECK (("bucket" = ANY (ARRAY['needs'::"text", 'wants'::"text", 'savings'::"text", 'none'::"text"])))
);


ALTER TABLE "public"."categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."debts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "counterparty" "text" NOT NULL,
    "direction" "text" DEFAULT 'owed_to_me'::"text" NOT NULL,
    "amount" numeric(14,2) NOT NULL,
    "tx_id" "uuid",
    "repaid_tx_id" "uuid",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "settled_at" timestamp with time zone,
    "note" "text",
    "ref" "text",
    "exclude_from_savings" boolean DEFAULT false NOT NULL,
    CONSTRAINT "debts_direction_check" CHECK (("direction" = ANY (ARRAY['owed_to_me'::"text", 'i_owe'::"text"]))),
    CONSTRAINT "debts_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'settled'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."debts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."diet_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "changed_on" "date" DEFAULT CURRENT_DATE NOT NULL,
    "phase" "text" NOT NULL,
    "calorie_intake" numeric(7,1) NOT NULL,
    "protein_g" numeric(6,1) NOT NULL,
    "carbs_g" numeric(6,1) NOT NULL,
    "fat_g" numeric(6,1) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."diet_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."diet_settings" (
    "user_id" "uuid" NOT NULL,
    "phase" "text" DEFAULT 'cut'::"text" NOT NULL,
    "calorie_intake" numeric(7,1) DEFAULT 2300 NOT NULL,
    "protein_g" numeric(6,1) DEFAULT 215 NOT NULL,
    "carbs_g" numeric(6,1) DEFAULT 149 NOT NULL,
    "fat_g" numeric(6,1) DEFAULT 94 NOT NULL,
    "protein_per_lb" numeric(4,2) DEFAULT 1.15 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "height_cm" numeric(5,1),
    CONSTRAINT "diet_settings_phase_check" CHECK (("phase" = ANY (ARRAY['cut'::"text", 'bulk'::"text"])))
);


ALTER TABLE "public"."diet_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "category" "public"."capital_category" DEFAULT 'productive'::"public"."capital_category" NOT NULL,
    "start_at" timestamp with time zone NOT NULL,
    "end_at" timestamp with time zone NOT NULL,
    "all_day" boolean DEFAULT false NOT NULL,
    "gcal_event_id" "text",
    "source" "text" DEFAULT 'local'::"text" NOT NULL,
    "task_id" "uuid",
    "synced_at" timestamp with time zone,
    "deleted" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."flashcards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "deck" "text" DEFAULT 'General'::"text" NOT NULL,
    "front" "text" NOT NULL,
    "back" "text" NOT NULL,
    "next_review" "date" DEFAULT CURRENT_DATE NOT NULL,
    "interval_days" integer DEFAULT 0 NOT NULL,
    "ease" numeric(4,2) DEFAULT 2.5 NOT NULL,
    "reps" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."flashcards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."food_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "group_name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."food_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."food_purchases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "item_id" "uuid" NOT NULL,
    "purchased_at" "date" DEFAULT CURRENT_DATE NOT NULL,
    "amount" numeric(14,2) NOT NULL,
    "expression" "text",
    "note" "text",
    "paid_cash" boolean DEFAULT false NOT NULL,
    "transaction_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "food_purchases_amount_check" CHECK (("amount" > (0)::numeric))
);


ALTER TABLE "public"."food_purchases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gcal_sync" (
    "user_id" "uuid" NOT NULL,
    "sync_token" "text",
    "channel_resource_id" "text",
    "channel_expiration" timestamp with time zone,
    "last_synced_at" timestamp with time zone
);


ALTER TABLE "public"."gcal_sync" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."google_tokens" (
    "user_id" "uuid" NOT NULL,
    "access_token" "text",
    "refresh_token" "text",
    "expires_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."google_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."income_splits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "pattern" "text" NOT NULL,
    "base_amount" numeric(14,2) NOT NULL,
    "remainder_type" "text" DEFAULT 'interest'::"text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "base_type" "text" DEFAULT 'income'::"text" NOT NULL,
    CONSTRAINT "income_splits_base_amount_check" CHECK (("base_amount" > (0)::numeric)),
    CONSTRAINT "income_splits_base_type_check" CHECK (("base_type" = ANY (ARRAY['income'::"text", 'interest'::"text", 'sponsorship'::"text", 'debt_repayment'::"text"]))),
    CONSTRAINT "income_splits_remainder_type_check" CHECK (("remainder_type" = ANY (ARRAY['interest'::"text", 'sponsorship'::"text", 'debt_repayment'::"text", 'family_savings'::"text"])))
);


ALTER TABLE "public"."income_splits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "priority" integer NOT NULL,
    "account_id" "uuid",
    "direction" "text",
    "pattern" "text" NOT NULL,
    "type" "text" NOT NULL,
    "category_id" "uuid",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "needs_review" boolean DEFAULT false NOT NULL,
    "cutoff_day" smallint,
    CONSTRAINT "rules_cutoff_day_check" CHECK ((("cutoff_day" IS NULL) OR (("cutoff_day" >= 1) AND ("cutoff_day" <= 31)))),
    CONSTRAINT "rules_direction_check" CHECK (("direction" = ANY (ARRAY['in'::"text", 'out'::"text"]))),
    CONSTRAINT "rules_type_check" CHECK (("type" = ANY (ARRAY['income'::"text", 'expense'::"text", 'savings'::"text", 'savings_withdrawal'::"text", 'internal_transfer'::"text", 'card_payment'::"text", 'sponsorship'::"text", 'interest'::"text", 'debt_repayment'::"text", 'family_savings'::"text", 'pass_through'::"text"])))
);


ALTER TABLE "public"."rules" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."transactions_budgeted" WITH ("security_invoker"='true') AS
 SELECT "id",
    "account_id",
    "occurred_at",
    "direction",
    "amount",
    "type",
    "category_id",
    "counterparty",
    "description",
    "source",
    "raw_text",
    "dedupe_hash",
    "needs_review",
    "matched_rule_id",
    "created_at",
    "paired_with",
    "date_trunc"('month'::"text", ("occurred_at" AT TIME ZONE 'America/Bogota'::"text")) AS "real_month",
    ("date_trunc"('month'::"text", ("occurred_at" AT TIME ZONE 'America/Bogota'::"text")) +
        CASE
            WHEN ((EXTRACT("day" FROM ("occurred_at" AT TIME ZONE 'America/Bogota'::"text")) >= (( SELECT "budget_split"."income_cutoff_day"
               FROM "public"."budget_split"))::numeric) OR (EXISTS ( SELECT 1
               FROM "public"."rules" "r"
              WHERE ("r"."active" AND ("r"."cutoff_day" IS NOT NULL) AND (("r"."direction" IS NULL) OR ("r"."direction" = "t"."direction")) AND (EXTRACT("day" FROM ("t"."occurred_at" AT TIME ZONE 'America/Bogota'::"text")) >= ("r"."cutoff_day")::numeric) AND (((COALESCE("t"."counterparty", ''::"text") || ' '::"text") || COALESCE("t"."description", ''::"text")) ~* "r"."pattern"))))) THEN '1 mon'::interval
            ELSE '00:00:00'::interval
        END) AS "budget_month",
    "label",
    "original_amount"
   FROM "public"."transactions" "t";


ALTER VIEW "public"."transactions_budgeted" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."monthly_budget" WITH ("security_invoker"='true') AS
 WITH "bs" AS (
         SELECT "budget_split"."id",
            "budget_split"."needs_pct",
            "budget_split"."wants_pct",
            "budget_split"."savings_pct",
            "budget_split"."updated_at",
            "budget_split"."income_cutoff_day",
            "budget_split"."tracking_start"
           FROM "public"."budget_split"
        ), "tx" AS (
         SELECT "transactions_budgeted"."id",
            "transactions_budgeted"."account_id",
            "transactions_budgeted"."occurred_at",
            "transactions_budgeted"."direction",
            "transactions_budgeted"."amount",
            "transactions_budgeted"."type",
            "transactions_budgeted"."category_id",
            "transactions_budgeted"."counterparty",
            "transactions_budgeted"."description",
            "transactions_budgeted"."source",
            "transactions_budgeted"."raw_text",
            "transactions_budgeted"."dedupe_hash",
            "transactions_budgeted"."needs_review",
            "transactions_budgeted"."matched_rule_id",
            "transactions_budgeted"."created_at",
            "transactions_budgeted"."paired_with",
            "transactions_budgeted"."real_month",
            "transactions_budgeted"."budget_month"
           FROM "public"."transactions_budgeted"
        ), "months" AS (
         SELECT "tx"."real_month" AS "month"
           FROM "tx"
        UNION
         SELECT "tx"."budget_month"
           FROM "tx"
          WHERE ("tx"."direction" = 'in'::"text")
        UNION
         SELECT "date_trunc"('month'::"text", ("food_purchases"."purchased_at")::timestamp without time zone) AS "date_trunc"
           FROM "public"."food_purchases"
        ), "income_by_month" AS (
         SELECT "tx"."budget_month" AS "month",
            "sum"("tx"."amount") AS "total_income"
           FROM "tx"
          WHERE ("tx"."type" = 'income'::"text")
          GROUP BY "tx"."budget_month"
        ), "spent_by_month_bucket" AS (
         SELECT "s"."month",
            "s"."bucket",
            "sum"("s"."total") AS "total"
           FROM ( SELECT "tx"."real_month" AS "month",
                    "c"."bucket",
                    "sum"("tx"."amount") AS "total"
                   FROM ("tx"
                     JOIN "public"."categories" "c" ON (("c"."id" = "tx"."category_id")))
                  WHERE ("tx"."type" = 'expense'::"text")
                  GROUP BY "tx"."real_month", "c"."bucket"
                UNION ALL
                 SELECT "date_trunc"('month'::"text", ("fp"."purchased_at")::timestamp without time zone) AS "date_trunc",
                    'needs'::"text",
                    "sum"("fp"."amount") AS "sum"
                   FROM "public"."food_purchases" "fp"
                  WHERE ("fp"."paid_cash" AND ("fp"."transaction_id" IS NULL))
                  GROUP BY ("date_trunc"('month'::"text", ("fp"."purchased_at")::timestamp without time zone))) "s"
          GROUP BY "s"."month", "s"."bucket"
        ), "savings_by_month" AS (
         SELECT "tx"."real_month" AS "month",
            "sum"(
                CASE
                    WHEN ("tx"."type" = 'savings'::"text") THEN "tx"."amount"
                    WHEN ("tx"."type" = 'savings_withdrawal'::"text") THEN (- "tx"."amount")
                    ELSE (0)::numeric
                END) AS "net_savings"
           FROM "tx"
          WHERE ("tx"."type" = ANY (ARRAY['savings'::"text", 'savings_withdrawal'::"text"]))
          GROUP BY "tx"."real_month"
        ), "unclassified_by_month" AS (
         SELECT "tx"."real_month" AS "month",
            "sum"("tx"."amount") AS "unclassified_expense"
           FROM "tx"
          WHERE ("tx"."needs_review" AND ("tx"."direction" = 'out'::"text"))
          GROUP BY "tx"."real_month"
        ), "extra_income_by_month" AS (
         SELECT "tx"."budget_month" AS "month",
            "sum"("tx"."amount") FILTER (WHERE ("tx"."type" = 'sponsorship'::"text")) AS "sponsorship_income",
            "sum"("tx"."amount") FILTER (WHERE ("tx"."type" = 'interest'::"text")) AS "interest_income",
            "sum"("tx"."amount") FILTER (WHERE ("tx"."type" = 'debt_repayment'::"text")) AS "debt_repayment_income",
            "sum"("tx"."amount") FILTER (WHERE ("tx"."type" = 'family_savings'::"text")) AS "family_savings_income"
           FROM "tx"
          WHERE ("tx"."type" = ANY (ARRAY['sponsorship'::"text", 'interest'::"text", 'debt_repayment'::"text", 'family_savings'::"text"]))
          GROUP BY "tx"."budget_month"
        )
 SELECT "m"."month",
    COALESCE("i"."total_income", (0)::numeric) AS "income",
    ((COALESCE("i"."total_income", (0)::numeric) * "bs"."needs_pct") / (100)::numeric) AS "needs_goal",
    COALESCE("sb"."total", (0)::numeric) AS "needs_spent",
    (((COALESCE("i"."total_income", (0)::numeric) * "bs"."needs_pct") / (100)::numeric) - COALESCE("sb"."total", (0)::numeric)) AS "needs_available",
    ((COALESCE("i"."total_income", (0)::numeric) * "bs"."wants_pct") / (100)::numeric) AS "wants_goal",
    COALESCE("sw"."total", (0)::numeric) AS "wants_spent",
    (((COALESCE("i"."total_income", (0)::numeric) * "bs"."wants_pct") / (100)::numeric) - COALESCE("sw"."total", (0)::numeric)) AS "wants_available",
    ((COALESCE("i"."total_income", (0)::numeric) * "bs"."savings_pct") / (100)::numeric) AS "savings_goal",
    COALESCE("sv"."net_savings", (0)::numeric) AS "savings_actual",
    (((COALESCE("i"."total_income", (0)::numeric) * "bs"."savings_pct") / (100)::numeric) - COALESCE("sv"."net_savings", (0)::numeric)) AS "savings_available",
    COALESCE("u"."unclassified_expense", (0)::numeric) AS "unclassified_expense",
    COALESCE("e"."sponsorship_income", (0)::numeric) AS "sponsorship_income",
    COALESCE("e"."interest_income", (0)::numeric) AS "interest_income",
    COALESCE("e"."debt_repayment_income", (0)::numeric) AS "debt_repayment_income",
    COALESCE("e"."family_savings_income", (0)::numeric) AS "family_savings_income"
   FROM ((((((("months" "m"
     CROSS JOIN "bs")
     LEFT JOIN "income_by_month" "i" ON (("i"."month" = "m"."month")))
     LEFT JOIN "spent_by_month_bucket" "sb" ON ((("sb"."month" = "m"."month") AND ("sb"."bucket" = 'needs'::"text"))))
     LEFT JOIN "spent_by_month_bucket" "sw" ON ((("sw"."month" = "m"."month") AND ("sw"."bucket" = 'wants'::"text"))))
     LEFT JOIN "savings_by_month" "sv" ON (("sv"."month" = "m"."month")))
     LEFT JOIN "unclassified_by_month" "u" ON (("u"."month" = "m"."month")))
     LEFT JOIN "extra_income_by_month" "e" ON (("e"."month" = "m"."month")))
  ORDER BY "m"."month";


ALTER VIEW "public"."monthly_budget" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."monthly_commitments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "direction" "text" NOT NULL,
    "pattern" "text" NOT NULL,
    "expected_amount" numeric(14,2) NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "counts_as_savings" boolean DEFAULT false NOT NULL,
    CONSTRAINT "monthly_commitments_direction_check" CHECK (("direction" = ANY (ARRAY['in'::"text", 'out'::"text"]))),
    CONSTRAINT "monthly_commitments_expected_amount_check" CHECK (("expected_amount" > (0)::numeric))
);


ALTER TABLE "public"."monthly_commitments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."savings_sources" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "kind" "text" DEFAULT 'other'::"text" NOT NULL,
    "direction" "text" DEFAULT 'in'::"text" NOT NULL,
    "principal" numeric(14,2) DEFAULT 0 NOT NULL,
    "rate_pct" numeric(6,3),
    "expected_monthly" numeric(14,2) DEFAULT 0 NOT NULL,
    "pattern" "text",
    "active" boolean DEFAULT true NOT NULL,
    "note" "text",
    "sort_order" smallint DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "savings_sources_direction_check" CHECK (("direction" = ANY (ARRAY['in'::"text", 'out'::"text"]))),
    CONSTRAINT "savings_sources_kind_check" CHECK (("kind" = ANY (ARRAY['loan'::"text", 'investment'::"text", 'voluntary'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."savings_sources" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."savings_progress" WITH ("security_invoker"='true') AS
 WITH "per_month" AS (
         SELECT "monthly_budget"."month",
            ((((("monthly_budget"."savings_goal" + "monthly_budget"."interest_income") + "monthly_budget"."sponsorship_income") + "monthly_budget"."debt_repayment_income") + "monthly_budget"."family_savings_income") + "src"."expected_out") AS "target",
            "monthly_budget"."savings_actual" AS "sent"
           FROM ("public"."monthly_budget"
             CROSS JOIN LATERAL ( SELECT COALESCE("sum"("s"."expected_monthly"), (0)::numeric) AS "expected_out"
                   FROM "public"."savings_sources" "s"
                  WHERE ("s"."active" AND ("s"."direction" = 'out'::"text") AND ("s"."expected_monthly" > (0)::numeric) AND ("date_trunc"('month'::"text", "s"."created_at") <= "monthly_budget"."month"))) "src")
          WHERE ("monthly_budget"."month" >= "date_trunc"('month'::"text", (( SELECT "budget_split"."tracking_start"
                   FROM "public"."budget_split"))::timestamp without time zone))
        )
 SELECT "month",
    "target",
    "sent",
    "sum"("target") OVER (ORDER BY "month") AS "cumulative_target",
    "sum"("sent") OVER (ORDER BY "month") AS "cumulative_sent",
    ("sum"("target") OVER (ORDER BY "month") - "sum"("sent") OVER (ORDER BY "month")) AS "remaining"
   FROM "per_month"
  ORDER BY "month";


ALTER VIEW "public"."savings_progress" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'backlog'::"text" NOT NULL,
    "priority" "text" DEFAULT 'medium'::"text" NOT NULL,
    "category" "public"."capital_category",
    "labels" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "subtasks" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "due_date" "date",
    "position" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."todos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "done" boolean DEFAULT false NOT NULL,
    "urgent" boolean DEFAULT false NOT NULL,
    "due_date" "date",
    "position" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."todos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."unparsed_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_name" "text" NOT NULL,
    "raw_text" "text" NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."unparsed_notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."weight_entries" (
    "user_id" "uuid" NOT NULL,
    "entry_date" "date" NOT NULL,
    "weight_lb" numeric(6,2) NOT NULL,
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "weight_entries_weight_lb_check" CHECK (("weight_lb" > (0)::numeric))
);


ALTER TABLE "public"."weight_entries" OWNER TO "postgres";


ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_secrets"
    ADD CONSTRAINT "app_secrets_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."budget_split"
    ADD CONSTRAINT "budget_split_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."debts"
    ADD CONSTRAINT "debts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."diet_history"
    ADD CONSTRAINT "diet_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."diet_settings"
    ADD CONSTRAINT "diet_settings_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_gcal_event_id_key" UNIQUE ("gcal_event_id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."flashcards"
    ADD CONSTRAINT "flashcards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."food_items"
    ADD CONSTRAINT "food_items_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."food_items"
    ADD CONSTRAINT "food_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."food_purchases"
    ADD CONSTRAINT "food_purchases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gcal_sync"
    ADD CONSTRAINT "gcal_sync_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."google_tokens"
    ADD CONSTRAINT "google_tokens_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."income_splits"
    ADD CONSTRAINT "income_splits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."monthly_commitments"
    ADD CONSTRAINT "monthly_commitments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rules"
    ADD CONSTRAINT "rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."savings_sources"
    ADD CONSTRAINT "savings_sources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."todos"
    ADD CONSTRAINT "todos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_dedupe_hash_key" UNIQUE ("dedupe_hash");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."unparsed_notifications"
    ADD CONSTRAINT "unparsed_notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."weight_entries"
    ADD CONSTRAINT "weight_entries_pkey" PRIMARY KEY ("user_id", "entry_date");



CREATE INDEX "debts_status_idx" ON "public"."debts" USING "btree" ("status");



CREATE INDEX "events_gcal" ON "public"."events" USING "btree" ("gcal_event_id");



CREATE INDEX "events_user_time" ON "public"."events" USING "btree" ("user_id", "start_at");



CREATE INDEX "flashcards_due" ON "public"."flashcards" USING "btree" ("user_id", "next_review");



CREATE INDEX "food_purchases_date_idx" ON "public"."food_purchases" USING "btree" ("purchased_at");



CREATE INDEX "rules_priority_idx" ON "public"."rules" USING "btree" ("priority") WHERE "active";



CREATE INDEX "tasks_user_status" ON "public"."tasks" USING "btree" ("user_id", "status", "position");



CREATE INDEX "todos_user" ON "public"."todos" USING "btree" ("user_id", "done", "position");



CREATE INDEX "transactions_account_idx" ON "public"."transactions" USING "btree" ("account_id");



CREATE INDEX "transactions_needs_review_idx" ON "public"."transactions" USING "btree" ("needs_review") WHERE "needs_review";



CREATE INDEX "transactions_occurred_at_idx" ON "public"."transactions" USING "btree" ("occurred_at");



CREATE INDEX "transactions_paired_with_idx" ON "public"."transactions" USING "btree" ("paired_with");



CREATE OR REPLACE TRIGGER "events_touch" BEFORE UPDATE ON "public"."events" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "tasks_touch" BEFORE UPDATE ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "transactions_apply_rules" BEFORE INSERT ON "public"."transactions" FOR EACH ROW EXECUTE FUNCTION "public"."apply_rules"();



CREATE OR REPLACE TRIGGER "transactions_confirm_partner" AFTER UPDATE OF "needs_review" ON "public"."transactions" FOR EACH ROW EXECUTE FUNCTION "public"."trg_confirm_partner"();



CREATE OR REPLACE TRIGGER "transactions_pair_after_insert" AFTER INSERT ON "public"."transactions" FOR EACH ROW EXECUTE FUNCTION "public"."trg_pair_after_insert"();



ALTER TABLE ONLY "public"."debts"
    ADD CONSTRAINT "debts_repaid_tx_id_fkey" FOREIGN KEY ("repaid_tx_id") REFERENCES "public"."transactions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."debts"
    ADD CONSTRAINT "debts_tx_id_fkey" FOREIGN KEY ("tx_id") REFERENCES "public"."transactions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."diet_history"
    ADD CONSTRAINT "diet_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."diet_settings"
    ADD CONSTRAINT "diet_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_task_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."flashcards"
    ADD CONSTRAINT "flashcards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."food_purchases"
    ADD CONSTRAINT "food_purchases_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."food_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."food_purchases"
    ADD CONSTRAINT "food_purchases_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."gcal_sync"
    ADD CONSTRAINT "gcal_sync_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."google_tokens"
    ADD CONSTRAINT "google_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rules"
    ADD CONSTRAINT "rules_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id");



ALTER TABLE ONLY "public"."rules"
    ADD CONSTRAINT "rules_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."todos"
    ADD CONSTRAINT "todos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_matched_rule_id_fkey" FOREIGN KEY ("matched_rule_id") REFERENCES "public"."rules"("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_paired_with_fkey" FOREIGN KEY ("paired_with") REFERENCES "public"."transactions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."weight_entries"
    ADD CONSTRAINT "weight_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE "public"."accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "accounts_authenticated_all" ON "public"."accounts" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."app_secrets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."budget_split" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "budget_split_authenticated_all" ON "public"."budget_split" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."categories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "categories_authenticated_all" ON "public"."categories" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."debts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "debts_authenticated_all" ON "public"."debts" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."diet_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."diet_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."flashcards" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."food_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "food_items_authenticated_all" ON "public"."food_items" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."food_purchases" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "food_purchases_authenticated_all" ON "public"."food_purchases" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."gcal_sync" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."google_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."income_splits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "income_splits_authenticated_all" ON "public"."income_splits" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."monthly_commitments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "monthly_commitments_authenticated_all" ON "public"."monthly_commitments" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "own events" ON "public"."events" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own sync" ON "public"."gcal_sync" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own tasks" ON "public"."tasks" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own todos" ON "public"."todos" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own_diet_history" ON "public"."diet_history" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own_diet_settings" ON "public"."diet_settings" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own_flashcards" ON "public"."flashcards" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own_weight" ON "public"."weight_entries" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."rules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rules_authenticated_all" ON "public"."rules" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."savings_sources" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "savings_sources_authenticated_all" ON "public"."savings_sources" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."todos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transactions_authenticated_all" ON "public"."transactions" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."unparsed_notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."weight_entries" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."apply_rules"() TO "anon";
GRANT ALL ON FUNCTION "public"."apply_rules"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_rules"() TO "service_role";



GRANT ALL ON TABLE "public"."transactions" TO "anon";
GRANT ALL ON TABLE "public"."transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."transactions" TO "service_role";



GRANT ALL ON FUNCTION "public"."is_pair_candidate"("t" "public"."transactions") TO "anon";
GRANT ALL ON FUNCTION "public"."is_pair_candidate"("t" "public"."transactions") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_pair_candidate"("t" "public"."transactions") TO "service_role";



GRANT ALL ON FUNCTION "public"."reapply_rules"() TO "anon";
GRANT ALL ON FUNCTION "public"."reapply_rules"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reapply_rules"() TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_confirm_partner"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_confirm_partner"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_confirm_partner"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_pair_after_insert"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_pair_after_insert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_pair_after_insert"() TO "service_role";



GRANT ALL ON FUNCTION "public"."try_pair_transaction"("n_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."try_pair_transaction"("n_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."try_pair_transaction"("n_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."accounts" TO "anon";
GRANT ALL ON TABLE "public"."accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."accounts" TO "service_role";



GRANT ALL ON TABLE "public"."app_secrets" TO "anon";
GRANT ALL ON TABLE "public"."app_secrets" TO "authenticated";
GRANT ALL ON TABLE "public"."app_secrets" TO "service_role";



GRANT ALL ON TABLE "public"."budget_split" TO "anon";
GRANT ALL ON TABLE "public"."budget_split" TO "authenticated";
GRANT ALL ON TABLE "public"."budget_split" TO "service_role";



GRANT ALL ON TABLE "public"."categories" TO "anon";
GRANT ALL ON TABLE "public"."categories" TO "authenticated";
GRANT ALL ON TABLE "public"."categories" TO "service_role";



GRANT ALL ON TABLE "public"."debts" TO "anon";
GRANT ALL ON TABLE "public"."debts" TO "authenticated";
GRANT ALL ON TABLE "public"."debts" TO "service_role";



GRANT ALL ON TABLE "public"."diet_history" TO "anon";
GRANT ALL ON TABLE "public"."diet_history" TO "authenticated";
GRANT ALL ON TABLE "public"."diet_history" TO "service_role";



GRANT ALL ON TABLE "public"."diet_settings" TO "anon";
GRANT ALL ON TABLE "public"."diet_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."diet_settings" TO "service_role";



GRANT ALL ON TABLE "public"."events" TO "anon";
GRANT ALL ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";



GRANT ALL ON TABLE "public"."flashcards" TO "anon";
GRANT ALL ON TABLE "public"."flashcards" TO "authenticated";
GRANT ALL ON TABLE "public"."flashcards" TO "service_role";



GRANT ALL ON TABLE "public"."food_items" TO "anon";
GRANT ALL ON TABLE "public"."food_items" TO "authenticated";
GRANT ALL ON TABLE "public"."food_items" TO "service_role";



GRANT ALL ON TABLE "public"."food_purchases" TO "anon";
GRANT ALL ON TABLE "public"."food_purchases" TO "authenticated";
GRANT ALL ON TABLE "public"."food_purchases" TO "service_role";



GRANT ALL ON TABLE "public"."gcal_sync" TO "anon";
GRANT ALL ON TABLE "public"."gcal_sync" TO "authenticated";
GRANT ALL ON TABLE "public"."gcal_sync" TO "service_role";



GRANT ALL ON TABLE "public"."google_tokens" TO "anon";
GRANT ALL ON TABLE "public"."google_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."google_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."income_splits" TO "anon";
GRANT ALL ON TABLE "public"."income_splits" TO "authenticated";
GRANT ALL ON TABLE "public"."income_splits" TO "service_role";



GRANT ALL ON TABLE "public"."rules" TO "anon";
GRANT ALL ON TABLE "public"."rules" TO "authenticated";
GRANT ALL ON TABLE "public"."rules" TO "service_role";



GRANT ALL ON TABLE "public"."transactions_budgeted" TO "anon";
GRANT ALL ON TABLE "public"."transactions_budgeted" TO "authenticated";
GRANT ALL ON TABLE "public"."transactions_budgeted" TO "service_role";



GRANT ALL ON TABLE "public"."monthly_budget" TO "anon";
GRANT ALL ON TABLE "public"."monthly_budget" TO "authenticated";
GRANT ALL ON TABLE "public"."monthly_budget" TO "service_role";



GRANT ALL ON TABLE "public"."monthly_commitments" TO "anon";
GRANT ALL ON TABLE "public"."monthly_commitments" TO "authenticated";
GRANT ALL ON TABLE "public"."monthly_commitments" TO "service_role";



GRANT ALL ON TABLE "public"."savings_sources" TO "anon";
GRANT ALL ON TABLE "public"."savings_sources" TO "authenticated";
GRANT ALL ON TABLE "public"."savings_sources" TO "service_role";



GRANT ALL ON TABLE "public"."savings_progress" TO "anon";
GRANT ALL ON TABLE "public"."savings_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."savings_progress" TO "service_role";



GRANT ALL ON TABLE "public"."tasks" TO "anon";
GRANT ALL ON TABLE "public"."tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."tasks" TO "service_role";



GRANT ALL ON TABLE "public"."todos" TO "anon";
GRANT ALL ON TABLE "public"."todos" TO "authenticated";
GRANT ALL ON TABLE "public"."todos" TO "service_role";



GRANT ALL ON TABLE "public"."unparsed_notifications" TO "anon";
GRANT ALL ON TABLE "public"."unparsed_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."unparsed_notifications" TO "service_role";



GRANT ALL ON TABLE "public"."weight_entries" TO "anon";
GRANT ALL ON TABLE "public"."weight_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."weight_entries" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
