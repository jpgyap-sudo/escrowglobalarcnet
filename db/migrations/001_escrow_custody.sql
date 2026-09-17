-- Escrow Global production custody schema, PostgreSQL 14+.
--
-- This migration stores chain-derived facts and an append-only audit surface;
-- it is not a substitute for the Solana program. Applications must use
-- parameterized queries, a restricted DB role, and finalized chain evidence.
-- No private keys, token-account secrets, or evidence file bytes belong here.

CREATE TABLE custody_deployments (
  deployment_id text PRIMARY KEY,
  network text NOT NULL CHECK (network IN ('devnet', 'testnet', 'mainnet-beta')),
  program_id bytea NOT NULL CHECK (octet_length(program_id) = 32),
  deployment_config_address bytea NOT NULL CHECK (octet_length(deployment_config_address) = 32),
  upgrade_authority bytea CHECK (upgrade_authority IS NULL OR octet_length(upgrade_authority) = 32),
  genesis_hash bytea NOT NULL CHECK (octet_length(genesis_hash) = 32),
  idl_hash bytea NOT NULL CHECK (octet_length(idl_hash) = 32),
  fee_recipient bytea NOT NULL CHECK (octet_length(fee_recipient) = 32),
  token_program_id bytea NOT NULL CHECK (octet_length(token_program_id) = 32),
  status text NOT NULL CHECK (status IN ('candidate', 'testnet', 'approved', 'revoked')),
  created_at timestamptz NOT NULL,
  approved_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (network, program_id, genesis_hash),
  UNIQUE (network, program_id, deployment_config_address)
);

CREATE TABLE custody_mint_admissions (
  deployment_id text NOT NULL REFERENCES custody_deployments (deployment_id),
  mint bytea NOT NULL CHECK (octet_length(mint) = 32),
  decimals smallint NOT NULL CHECK (decimals >= 0 AND decimals <= 255),
  paused boolean NOT NULL DEFAULT false,
  per_deal_cap numeric(20, 0) NOT NULL CHECK (per_deal_cap > 0 AND per_deal_cap <= 18446744073709551615),
  outstanding_cap numeric(30, 0) NOT NULL CHECK (outstanding_cap > 0),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (deployment_id, mint)
);

CREATE TABLE custody_agreements (
  agreement_id text PRIMARY KEY,
  deployment_id text NOT NULL REFERENCES custody_deployments (deployment_id),
  agreement_address bytea NOT NULL CHECK (octet_length(agreement_address) = 32),
  agreement_id_hash bytea NOT NULL CHECK (octet_length(agreement_id_hash) = 32),
  terms_hash bytea NOT NULL CHECK (octet_length(terms_hash) = 32),
  buyer bytea NOT NULL CHECK (octet_length(buyer) = 32),
  seller bytea NOT NULL CHECK (octet_length(seller) = 32),
  arbiter bytea NOT NULL CHECK (octet_length(arbiter) = 32),
  fee_recipient bytea NOT NULL CHECK (octet_length(fee_recipient) = 32),
  mint bytea NOT NULL CHECK (octet_length(mint) = 32),
  protocol_version text NOT NULL CHECK (protocol_version IN ('v1', 'v2')),
  state text NOT NULL,
  -- Decision revisions are serialized as u64 on-chain; signed BIGINT would
  -- truncate valid high-bit values.
  state_revision numeric(20, 0) NOT NULL CHECK (state_revision >= 0 AND state_revision <= 18446744073709551615),
  -- V1 stores its single-vault economics on the agreement itself. V2 keeps
  -- these fields on custody_milestones and leaves the parent columns NULL.
  principal numeric(20, 0) CHECK (principal IS NULL OR (principal > 0 AND principal <= 18446744073709551615)),
  fee_reserve numeric(20, 0) CHECK (fee_reserve IS NULL OR (fee_reserve >= 0 AND fee_reserve <= 18446744073709551615)),
  expected_total numeric(20, 0) CHECK (expected_total IS NULL OR (expected_total > 0 AND expected_total <= 18446744073709551615)),
  seller_entitlement numeric(20, 0) CHECK (seller_entitlement IS NULL OR seller_entitlement >= 0),
  fee_entitlement numeric(20, 0) CHECK (fee_entitlement IS NULL OR fee_entitlement >= 0),
  buyer_entitlement numeric(20, 0) CHECK (buyer_entitlement IS NULL OR buyer_entitlement >= 0),
  unresolved_principal numeric(20, 0) CHECK (unresolved_principal IS NULL OR unresolved_principal >= 0),
  vault_address bytea CHECK (vault_address IS NULL OR octet_length(vault_address) = 32),
  vault_amount numeric(20, 0) CHECK (vault_amount IS NULL OR vault_amount >= 0),
  observed_slot bigint CHECK (observed_slot >= 0),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  UNIQUE (deployment_id, agreement_id_hash),
  UNIQUE (deployment_id, agreement_address),
  CHECK (
    (protocol_version = 'v1' AND principal IS NOT NULL AND fee_reserve IS NOT NULL AND
      expected_total IS NOT NULL AND seller_entitlement IS NOT NULL AND fee_entitlement IS NOT NULL AND
      buyer_entitlement IS NOT NULL AND unresolved_principal IS NOT NULL AND vault_address IS NOT NULL AND
      vault_amount IS NOT NULL AND principal + fee_reserve = expected_total AND
      seller_entitlement + fee_entitlement + buyer_entitlement <= vault_amount AND
      unresolved_principal <= principal)
    OR
    (protocol_version = 'v2' AND principal IS NULL AND fee_reserve IS NULL AND expected_total IS NULL AND
      seller_entitlement IS NULL AND fee_entitlement IS NULL AND buyer_entitlement IS NULL AND
      unresolved_principal IS NULL AND vault_address IS NULL AND vault_amount IS NULL)
  ),
  CHECK (
    (protocol_version = 'v1' AND state IN ('Funded', 'Submitted', 'Disputed', 'Approved', 'CommonGround', 'SellerPaid', 'Refunded', 'Closed'))
    OR
    (protocol_version = 'v2' AND state IN ('Accepted', 'Closed'))
  ),
  CHECK (buyer <> seller AND buyer <> arbiter AND buyer <> fee_recipient
    AND seller <> arbiter AND seller <> fee_recipient AND arbiter <> fee_recipient)
);

CREATE TABLE custody_terms_versions (
  agreement_id text NOT NULL REFERENCES custody_agreements (agreement_id),
  version integer NOT NULL CHECK (version >= 1),
  terms_hash bytea NOT NULL CHECK (octet_length(terms_hash) = 32),
  terms_json jsonb NOT NULL,
  accepted_by_buyer_at timestamptz,
  accepted_by_seller_at timestamptz,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (agreement_id, version),
  UNIQUE (agreement_id, terms_hash)
);

CREATE TABLE custody_milestones (
  agreement_id text NOT NULL REFERENCES custody_agreements (agreement_id),
  milestone_index smallint NOT NULL CHECK (milestone_index >= 0 AND milestone_index <= 15),
  milestone_address bytea NOT NULL CHECK (octet_length(milestone_address) = 32),
  vault_address bytea NOT NULL CHECK (octet_length(vault_address) = 32),
  principal numeric(20, 0) NOT NULL CHECK (principal > 0 AND principal <= 18446744073709551615),
  fee_reserve numeric(20, 0) NOT NULL CHECK (fee_reserve >= 0 AND fee_reserve <= 18446744073709551615),
  expected_total numeric(20, 0) NOT NULL CHECK (expected_total > 0 AND expected_total <= 18446744073709551615),
  state text NOT NULL,
  seller_entitlement numeric(20, 0) NOT NULL DEFAULT 0 CHECK (seller_entitlement >= 0),
  fee_entitlement numeric(20, 0) NOT NULL DEFAULT 0 CHECK (fee_entitlement >= 0),
  buyer_entitlement numeric(20, 0) NOT NULL DEFAULT 0 CHECK (buyer_entitlement >= 0),
  vault_amount numeric(20, 0) NOT NULL DEFAULT 0 CHECK (vault_amount >= 0),
  observed_slot bigint CHECK (observed_slot >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (agreement_id, milestone_index),
  UNIQUE (agreement_id, milestone_address),
  UNIQUE (agreement_id, vault_address),
  CHECK (principal + fee_reserve = expected_total),
  CHECK (seller_entitlement + fee_entitlement + buyer_entitlement <= vault_amount),
  CHECK (state IN ('Funded', 'Submitted', 'Disputed', 'Approved', 'SellerPaid', 'Refunded', 'Closed'))
);

CREATE TABLE custody_operations (
  operation_id text PRIMARY KEY CHECK (length(operation_id) BETWEEN 1 AND 128),
  -- A prepare operation may be initialize-agreement, so the agreement does
  -- not exist yet. The durable request itself remains the authorization
  -- record; later projectors can bind it to an agreement after finality.
  agreement_id text REFERENCES custody_agreements (agreement_id),
  action text NOT NULL DEFAULT 'external_wallet',
  intent_hash bytea NOT NULL CHECK (octet_length(intent_hash) = 32),
  state text NOT NULL CHECK (state IN ('prepared', 'signed', 'relaying', 'submitted', 'confirmed', 'finalized', 'unknown', 'failed', 'expired', 'cancelled')),
  request jsonb NOT NULL CHECK (jsonb_typeof(request) = 'object'),
  attempt jsonb NOT NULL CHECK (jsonb_typeof(attempt) = 'object'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  -- Intent hashes are the replay key even before initialize creates an
  -- agreement row; NULL agreement_id must not weaken that guarantee.
  UNIQUE (action, intent_hash)
);

CREATE TABLE custody_attempts (
  operation_id text NOT NULL REFERENCES custody_operations (operation_id),
  attempt integer NOT NULL CHECK (attempt >= 1),
  state text NOT NULL CHECK (state IN ('draft', 'awaiting_signature', 'signed', 'submitted', 'confirmed', 'finalized', 'unknown', 'failed', 'expired', 'cancelled')),
  signature text,
  last_valid_block_height numeric(20, 0),
  failure_code text,
  failure_reason text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (operation_id, attempt),
  UNIQUE (signature),
  CHECK (signature IS NULL OR length(signature) BETWEEN 1 AND 128),
  CHECK ((state = 'failed' AND failure_reason IS NOT NULL) OR (state <> 'failed' AND failure_reason IS NULL)),
  CHECK ((state IN ('signed', 'submitted', 'confirmed', 'finalized', 'unknown') AND signature IS NOT NULL) OR state NOT IN ('signed', 'submitted', 'confirmed', 'finalized', 'unknown'))
);

CREATE TABLE custody_chain_events (
  deployment_id text NOT NULL REFERENCES custody_deployments (deployment_id),
  network text NOT NULL CHECK (network IN ('devnet', 'testnet', 'mainnet-beta')),
  -- The emitting program is part of the immutable event identity. A
  -- transaction may invoke multiple programs at the same position.
  program_id bytea NOT NULL CHECK (octet_length(program_id) = 32),
  signature text NOT NULL CHECK (length(signature) BETWEEN 1 AND 128),
  instruction_index integer NOT NULL CHECK (instruction_index >= 0),
  event_index integer NOT NULL CHECK (event_index >= 0 AND event_index < 64),
  slot bigint NOT NULL CHECK (slot >= 0),
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (deployment_id, network, program_id, signature, instruction_index, event_index)
);

CREATE TABLE custody_evidence_objects (
  evidence_digest bytea PRIMARY KEY CHECK (octet_length(evidence_digest) = 32),
  storage_key text NOT NULL UNIQUE,
  media_type text NOT NULL,
  byte_length bigint NOT NULL CHECK (byte_length >= 0),
  encrypted boolean NOT NULL,
  retention_until timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE custody_outbox (
  outbox_id uuid PRIMARY KEY,
  topic text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  available_at timestamptz NOT NULL,
  claimed_at timestamptz,
  delivered_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at timestamptz NOT NULL
);

-- A page cursor is only a scan checkpoint. It is never used as proof of
-- finality; every signature is re-read at finalized commitment before its
-- events can be admitted to custody_chain_events.
CREATE TABLE custody_indexer_cursors (
  network text NOT NULL CHECK (network IN ('devnet', 'testnet', 'mainnet-beta')),
  deployment_id text NOT NULL REFERENCES custody_deployments (deployment_id),
  address bytea NOT NULL CHECK (octet_length(address) = 32),
  before_signature text CHECK (before_signature IS NULL OR length(before_signature) BETWEEN 1 AND 128),
  last_scanned_slot bigint CHECK (last_scanned_slot IS NULL OR last_scanned_slot >= 0),
  exhausted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (network, deployment_id, address)
);

CREATE INDEX custody_agreements_open_idx ON custody_agreements (deployment_id, state, observed_slot);
CREATE INDEX custody_milestones_open_idx ON custody_milestones (agreement_id, state, observed_slot);
CREATE INDEX custody_events_slot_idx ON custody_chain_events (deployment_id, network, program_id, slot);
CREATE INDEX custody_attempts_pending_idx ON custody_attempts (state, updated_at);
CREATE INDEX custody_indexer_cursor_updated_idx ON custody_indexer_cursors (updated_at);

CREATE FUNCTION custody_validate_indexer_cursor() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  deployment_network text;
BEGIN
  SELECT network INTO deployment_network
    FROM custody_deployments WHERE deployment_id = NEW.deployment_id;
  IF deployment_network IS NULL OR deployment_network <> NEW.network THEN
    RAISE EXCEPTION 'indexer cursor network differs from deployment network';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER custody_indexer_cursor_deployment_network
  BEFORE INSERT OR UPDATE ON custody_indexer_cursors
  FOR EACH ROW EXECUTE FUNCTION custody_validate_indexer_cursor();

CREATE FUNCTION custody_validate_chain_event_deployment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  deployment_network text;
  deployment_program_id bytea;
BEGIN
  SELECT network, program_id INTO deployment_network, deployment_program_id
    FROM custody_deployments WHERE deployment_id = NEW.deployment_id;
  IF deployment_network IS NULL
     OR deployment_network <> NEW.network
     OR deployment_program_id IS DISTINCT FROM NEW.program_id THEN
    RAISE EXCEPTION 'chain event deployment, network and program do not match';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER custody_chain_events_deployment_binding
  BEFORE INSERT OR UPDATE ON custody_chain_events
  FOR EACH ROW EXECUTE FUNCTION custody_validate_chain_event_deployment();

-- Agreement/milestone bindings are immutable after insertion. State and
-- finalized observation columns may advance, but the recipient, mint, PDA,
-- economics and commitment cannot be rewritten by a projection refresh.
CREATE FUNCTION custody_reject_binding_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'custody_agreements' AND (
    NEW.agreement_id IS DISTINCT FROM OLD.agreement_id OR
    NEW.deployment_id IS DISTINCT FROM OLD.deployment_id OR
    NEW.agreement_address IS DISTINCT FROM OLD.agreement_address OR
    NEW.agreement_id_hash IS DISTINCT FROM OLD.agreement_id_hash OR
    NEW.terms_hash IS DISTINCT FROM OLD.terms_hash OR
    NEW.buyer IS DISTINCT FROM OLD.buyer OR NEW.seller IS DISTINCT FROM OLD.seller OR
    NEW.arbiter IS DISTINCT FROM OLD.arbiter OR NEW.fee_recipient IS DISTINCT FROM OLD.fee_recipient OR
    NEW.mint IS DISTINCT FROM OLD.mint OR NEW.protocol_version IS DISTINCT FROM OLD.protocol_version OR
    NEW.principal IS DISTINCT FROM OLD.principal OR NEW.fee_reserve IS DISTINCT FROM OLD.fee_reserve OR
    NEW.expected_total IS DISTINCT FROM OLD.expected_total OR NEW.vault_address IS DISTINCT FROM OLD.vault_address
  ) THEN
    RAISE EXCEPTION 'immutable custody agreement binding cannot be changed';
  ELSIF TG_TABLE_NAME = 'custody_agreements' AND (
    NEW.state_revision < OLD.state_revision OR
    (NEW.observed_slot IS NOT NULL AND OLD.observed_slot IS NOT NULL AND NEW.observed_slot < OLD.observed_slot)
  ) THEN
    RAISE EXCEPTION 'custody agreement projection cannot move backward';
  ELSIF TG_TABLE_NAME = 'custody_milestones' AND (
    NEW.agreement_id IS DISTINCT FROM OLD.agreement_id OR
    NEW.milestone_index IS DISTINCT FROM OLD.milestone_index OR
    NEW.milestone_address IS DISTINCT FROM OLD.milestone_address OR
    NEW.vault_address IS DISTINCT FROM OLD.vault_address OR
    NEW.principal IS DISTINCT FROM OLD.principal OR NEW.fee_reserve IS DISTINCT FROM OLD.fee_reserve OR
    NEW.expected_total IS DISTINCT FROM OLD.expected_total
  ) THEN
    RAISE EXCEPTION 'immutable custody milestone binding cannot be changed';
  ELSIF TG_TABLE_NAME = 'custody_milestones' AND (
    (NEW.observed_slot IS NOT NULL AND OLD.observed_slot IS NOT NULL AND NEW.observed_slot < OLD.observed_slot)
  ) THEN
    RAISE EXCEPTION 'custody milestone projection cannot move backward';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER custody_agreement_binding_immutable
  BEFORE UPDATE ON custody_agreements
  FOR EACH ROW EXECUTE FUNCTION custody_reject_binding_mutation();

CREATE TRIGGER custody_milestone_binding_immutable
  BEFORE UPDATE ON custody_milestones
  FOR EACH ROW EXECUTE FUNCTION custody_reject_binding_mutation();

-- Every agreement must use the deployment's fixed fee recipient and an
-- explicitly admitted mint. Cross-table policy cannot be expressed by a
-- simple CHECK, so this trigger is part of the migration's security boundary.
CREATE FUNCTION custody_validate_agreement_admission() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  expected_fee bytea;
BEGIN
  SELECT fee_recipient INTO expected_fee
    FROM custody_deployments WHERE deployment_id = NEW.deployment_id;
  IF expected_fee IS NULL THEN
    RAISE EXCEPTION 'custody deployment does not exist';
  END IF;
  IF NEW.fee_recipient <> expected_fee THEN
    RAISE EXCEPTION 'agreement fee recipient differs from deployment policy';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM custody_mint_admissions
      WHERE deployment_id = NEW.deployment_id AND mint = NEW.mint AND paused = false
  ) THEN
    RAISE EXCEPTION 'agreement mint is not currently admitted';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER custody_agreement_admission
  BEFORE INSERT ON custody_agreements
  FOR EACH ROW EXECUTE FUNCTION custody_validate_agreement_admission();

-- Terms and finalized chain facts are append-only. State projections may be
-- rebuilt from these facts; application roles must not update or delete them.
CREATE FUNCTION custody_reject_append_only_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only custody table % cannot be mutated', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER custody_terms_append_only
  BEFORE UPDATE OR DELETE ON custody_terms_versions
  FOR EACH ROW EXECUTE FUNCTION custody_reject_append_only_mutation();

CREATE TRIGGER custody_chain_events_append_only
  BEFORE UPDATE OR DELETE ON custody_chain_events
  FOR EACH ROW EXECUTE FUNCTION custody_reject_append_only_mutation();

COMMENT ON TABLE custody_chain_events IS 'Finalized, deduplicated chain facts keyed by deployment/network/program/signature/instruction/event position; never a browser callback.';
COMMENT ON TABLE custody_evidence_objects IS 'Encrypted object-storage references only; never upload raw evidence bytes to PostgreSQL.';
