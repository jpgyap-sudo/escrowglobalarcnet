# Token program policy

The current `escrow_global` Anchor custody slice supports **only the legacy
SPL Token program** (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`). The
unsigned intent builder rejects Token-2022 before a wallet review can begin.

This is deliberate: the on-chain program uses `anchor_spl::token` account
constraints, and Token-2022 extensions can change transfer behavior through
fees, hooks, delegates, or confidential-transfer rules. Accepting a
Token-2022 mint without explicit extension policy would create an opaque
client/on-chain mismatch and could invalidate the amount-conservation model.

Adding Token-2022 is a separate audited protocol slice. It must migrate the
program to `token_interface`, allow-list safe extensions, test fee/hook
behavior, regenerate the IDL, and be deployed under new operational controls.
No Token-2022 funds are enabled by this repository.
