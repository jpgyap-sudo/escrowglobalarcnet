#![cfg(feature = "test-mints")]

use anchor_lang::{
    AccountDeserialize, AnchorSerialize, Discriminator, InstructionData, ToAccountMetas,
};
use solana_program::program_option::COption;
use solana_program_pack::Pack;
use solana_program_test::{processor, ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::Account,
    instruction::Instruction,
    pubkey::Pubkey,
    rent::Rent,
    signature::{Keypair, Signer},
    system_instruction,
    transaction::Transaction,
};
use spl_token::state::{Account as TokenAccountState, Mint};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

const DECIMALS: u8 = 6;
const PRINCIPAL: u64 = 450_000_000;

fn deadline_args() -> (i64, i64, i64) {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    (now + 86_400, now + 2 * 86_400, now + 3 * 86_400)
}

async fn process(
    context: &mut ProgramTestContext,
    instructions: Vec<Instruction>,
    extra_signers: &[&Keypair],
) -> Result<(), solana_program_test::BanksClientError> {
    let blockhash = context.banks_client.get_latest_blockhash().await?;
    let mut signers = vec![&context.payer];
    signers.extend_from_slice(extra_signers);
    let transaction = Transaction::new_signed_with_payer(
        &instructions,
        Some(&context.payer.pubkey()),
        &signers,
        blockhash,
    );
    context.banks_client.process_transaction(transaction).await
}

async fn process_partial(
    context: &mut ProgramTestContext,
    instructions: Vec<Instruction>,
    extra_signers: &[&Keypair],
) -> Result<(), solana_program_test::BanksClientError> {
    let blockhash = context.banks_client.get_latest_blockhash().await?;
    let mut signers = vec![&context.payer];
    signers.extend_from_slice(extra_signers);
    let mut transaction = Transaction::new_with_payer(&instructions, Some(&context.payer.pubkey()));
    transaction.partial_sign(&signers, blockhash);
    context.banks_client.process_transaction(transaction).await
}

fn token_account(
    payer: &Pubkey,
    address: &Keypair,
    owner: &Pubkey,
    mint: &Pubkey,
) -> Vec<Instruction> {
    vec![
        system_instruction::create_account(
            payer,
            &address.pubkey(),
            Rent::default().minimum_balance(TokenAccountState::LEN),
            TokenAccountState::LEN as u64,
            &spl_token::id(),
        ),
        spl_token::instruction::initialize_account(
            &spl_token::id(),
            &address.pubkey(),
            mint,
            owner,
        )
        .unwrap(),
    ]
}

fn escrow_addresses(buyer: &Pubkey, agreement_id_hash: &[u8; 32]) -> (Pubkey, Pubkey) {
    let (escrow, _) = Pubkey::find_program_address(
        &[b"escrow", buyer.as_ref(), agreement_id_hash],
        &escrow_global::id(),
    );
    let (vault, _) =
        Pubkey::find_program_address(&[b"vault", escrow.as_ref()], &escrow_global::id());
    (escrow, vault)
}

fn deployment_config_address() -> Pubkey {
    Pubkey::find_program_address(
        &[escrow_global::DEPLOYMENT_CONFIG_SEED],
        &escrow_global::id(),
    )
    .0
}

fn deployment_config_bump() -> u8 {
    Pubkey::find_program_address(
        &[escrow_global::DEPLOYMENT_CONFIG_SEED],
        &escrow_global::id(),
    )
    .1
}

fn v2_escrow_address(buyer: &Pubkey, agreement_id_hash: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(
        &[b"escrow-v2", buyer.as_ref(), agreement_id_hash],
        &escrow_global::id(),
    )
    .0
}

fn v2_milestone_addresses(escrow: &Pubkey, index: u16) -> (Pubkey, Pubkey) {
    let milestone = Pubkey::find_program_address(
        &[b"milestone-v2", escrow.as_ref(), &index.to_le_bytes()],
        &escrow_global::id(),
    )
    .0;
    let vault =
        Pubkey::find_program_address(&[b"vault-v2", milestone.as_ref()], &escrow_global::id()).0;
    (milestone, vault)
}

fn common_ground_address(escrow: &Pubkey, nonce: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[b"common-ground", escrow.as_ref(), &nonce.to_le_bytes()],
        &escrow_global::id(),
    )
    .0
}

fn initialize_ix(
    buyer: &Keypair,
    seller: &Keypair,
    arbiter: &Keypair,
    fee: &Keypair,
    mint: &Pubkey,
    agreement_id_hash: [u8; 32],
    terms_hash: [u8; 32],
) -> Instruction {
    let (escrow, vault) = escrow_addresses(&buyer.pubkey(), &agreement_id_hash);
    let (funding_deadline, delivery_deadline, review_deadline) = deadline_args();
    Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::Initialize {
            buyer: buyer.pubkey(),
            seller: seller.pubkey(),
            arbiter: arbiter.pubkey(),
            deployment_config: deployment_config_address(),
            mint: *mint,
            escrow,
            vault,
            token_program: spl_token::id(),
            system_program: solana_sdk::system_program::id(),
        }
        .to_account_metas(None),
        data: escrow_global::instruction::Initialize {
            agreement_id_hash,
            terms_hash,
            principal: PRINCIPAL,
            funding_deadline,
            delivery_deadline,
            review_deadline,
            timed_release: false,
        }
        .data(),
    }
}

fn initialize_v2_ix(
    buyer: &Keypair,
    seller: &Keypair,
    arbiter: &Keypair,
    fee: &Keypair,
    mint: &Pubkey,
    agreement_id_hash: [u8; 32],
    terms_hash: [u8; 32],
    milestone_count: u16,
) -> Instruction {
    let escrow = v2_escrow_address(&buyer.pubkey(), &agreement_id_hash);
    Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::InitializeV2 {
            buyer: buyer.pubkey(),
            seller: seller.pubkey(),
            arbiter: arbiter.pubkey(),
            deployment_config: deployment_config_address(),
            mint: *mint,
            escrow,
            system_program: solana_sdk::system_program::id(),
        }
        .to_account_metas(None),
        data: escrow_global::instruction::InitializeV2 {
            agreement_id_hash,
            terms_hash,
            milestone_count,
        }
        .data(),
    }
}

fn create_milestone_v2_ix(
    buyer: &Keypair,
    escrow: &Pubkey,
    mint: &Pubkey,
    index: u16,
    principal: u64,
    deadlines: (i64, i64, i64),
    timed_release: bool,
) -> Instruction {
    let (milestone, vault) = v2_milestone_addresses(escrow, index);
    let (funding_deadline, delivery_deadline, review_deadline) = deadlines;
    Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::CreateMilestoneV2 {
            buyer: buyer.pubkey(),
            escrow: *escrow,
            mint: *mint,
            milestone,
            vault,
            token_program: spl_token::id(),
            system_program: solana_sdk::system_program::id(),
        }
        .to_account_metas(None),
        data: escrow_global::instruction::CreateMilestoneV2 {
            index,
            principal,
            funding_deadline,
            delivery_deadline,
            review_deadline,
            timed_release,
        }
        .data(),
    }
}

fn test_program(
    authority: Pubkey,
    fee_recipient: Pubkey,
    mint: Pubkey,
    mint_authority: Pubkey,
) -> ProgramTest {
    let artifact_available = ["BPF_OUT_DIR", "SBF_OUT_DIR"]
        .into_iter()
        .filter_map(|name| std::env::var_os(name))
        .map(|directory| Path::new(&directory).join("escrow_global.so"))
        .any(|artifact| artifact.is_file());
    let mut program = ProgramTest::default();
    if artifact_available {
        // Solana 2.3's legacy add_program path stores an executable account
        // under the old loader. Use the upgradeable genesis layout so the
        // SBF runtime recognizes both the program and its ProgramData PDA.
        program.add_upgradeable_program_to_genesis("escrow_global", &escrow_global::id());
    } else {
        program.add_program(
            "escrow_global",
            escrow_global::id(),
            processor!(process_escrow_instruction),
        );
    }
    // Keep the test-only SPL Token processor native. No later program may be
    // added with an implicit loader choice.
    program.prefer_bpf(false);
    // Seed only the deployment config needed by lifecycle cases. The
    // InitializeConfig loader-authority path is covered by the release gate;
    // native ProgramTest uses a legacy loader account and cannot exercise it.
    let mut deployment_config = Vec::new();
    deployment_config.extend_from_slice(&escrow_global::DeploymentConfig::DISCRIMINATOR);
    escrow_global::DeploymentConfig {
        authority,
        fee_recipient,
        accepted_mints: [escrow_global::DEVNET_USDC_MINT, Pubkey::default()],
        bump: deployment_config_bump(),
    }
    .serialize(&mut deployment_config)
    .unwrap();
    program.add_account(
        deployment_config_address(),
        Account {
            lamports: Rent::default()
                .minimum_balance(deployment_config.len())
                .max(1),
            data: deployment_config,
            owner: escrow_global::id(),
            executable: false,
            rent_epoch: 0,
        },
    );
    let mut mint_data = vec![0u8; Mint::LEN];
    Mint {
        mint_authority: COption::Some(mint_authority),
        supply: 0,
        decimals: DECIMALS,
        is_initialized: true,
        freeze_authority: COption::None,
    }
    .pack_into_slice(&mut mint_data);
    program.add_account(
        mint,
        Account {
            lamports: Rent::default().minimum_balance(mint_data.len()).max(1),
            data: mint_data,
            owner: spl_token::id(),
            executable: false,
            rent_epoch: 0,
        },
    );
    program.add_program(
        "spl_token",
        spl_token::id(),
        processor!(spl_token::processor::Processor::process),
    );
    program
}

fn process_escrow_instruction<'a, 'b, 'c, 'd>(
    program_id: &Pubkey,
    accounts: &'b [solana_sdk::account_info::AccountInfo<'c>],
    instruction_data: &'d [u8],
) -> solana_sdk::entrypoint::ProgramResult {
    // ProgramTest accepts independent slice/account lifetimes while Anchor's
    // generated entry point ties them together for the duration of a call.
    let accounts: &'b [solana_sdk::account_info::AccountInfo<'b>] =
        unsafe { std::mem::transmute(accounts) };
    escrow_global::entry(program_id, accounts, instruction_data)
}

async fn setup() -> (
    ProgramTestContext,
    Keypair,
    Keypair,
    Keypair,
    Keypair,
    Pubkey,
    Keypair,
    Keypair,
    Keypair,
) {
    let authority = Keypair::new();
    let fee = Keypair::new();
    let mint_authority = Keypair::new();
    let mint: Pubkey = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
        .parse()
        .unwrap();
    let mut context = test_program(
        authority.pubkey(),
        fee.pubkey(),
        mint,
        mint_authority.pubkey(),
    )
    .start_with_context()
    .await;
    let buyer = Keypair::new();
    let seller = Keypair::new();
    let arbiter = Keypair::new();
    let buyer_tokens = Keypair::new();
    let seller_tokens = Keypair::new();
    let fee_tokens = Keypair::new();

    let mut setup_ix = vec![
        system_instruction::transfer(&context.payer.pubkey(), &buyer.pubkey(), 10_000_000_000),
        system_instruction::transfer(&context.payer.pubkey(), &seller.pubkey(), 2_000_000_000),
        system_instruction::transfer(&context.payer.pubkey(), &arbiter.pubkey(), 2_000_000_000),
        system_instruction::transfer(&context.payer.pubkey(), &fee.pubkey(), 2_000_000_000),
    ];
    setup_ix.extend(token_account(
        &context.payer.pubkey(),
        &buyer_tokens,
        &buyer.pubkey(),
        &mint,
    ));
    setup_ix.extend(token_account(
        &context.payer.pubkey(),
        &seller_tokens,
        &seller.pubkey(),
        &mint,
    ));
    setup_ix.extend(token_account(
        &context.payer.pubkey(),
        &fee_tokens,
        &fee.pubkey(),
        &mint,
    ));
    setup_ix.push(
        spl_token::instruction::mint_to(
            &spl_token::id(),
            &mint,
            &buyer_tokens.pubkey(),
            &mint_authority.pubkey(),
            &[],
            PRINCIPAL * 2,
        )
        .unwrap(),
    );
    let signers = [&mint_authority, &buyer_tokens, &seller_tokens, &fee_tokens];
    process(&mut context, setup_ix, &signers).await.unwrap();
    (
        context,
        buyer,
        seller,
        arbiter,
        fee,
        mint,
        buyer_tokens,
        seller_tokens,
        fee_tokens,
    )
}

fn accept_ix(seller: &Pubkey, escrow: &Pubkey, terms_hash: [u8; 32]) -> Instruction {
    Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::SellerAccept {
            seller: *seller,
            escrow: *escrow,
        }
        .to_account_metas(None),
        data: escrow_global::instruction::SellerAccept { terms_hash }.data(),
    }
}

#[tokio::test]
async fn happy_path_and_ordered_fee_claim_execute_in_runtime() {
    let (mut context, buyer, seller, arbiter, fee, mint, buyer_tokens, seller_tokens, fee_tokens) =
        setup().await;
    let agreement_id_hash = [7u8; 32];
    let terms_hash = [8u8; 32];
    let (escrow, vault) = escrow_addresses(&buyer.pubkey(), &agreement_id_hash);

    process(
        &mut context,
        vec![initialize_ix(
            &buyer,
            &seller,
            &arbiter,
            &fee,
            &mint,
            agreement_id_hash,
            terms_hash,
        )],
        &[&buyer, &arbiter],
    )
    .await
    .unwrap();
    let fund_ix = Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::Fund {
            buyer: buyer.pubkey(),
            escrow,
            mint: mint,
            vault,
            buyer_token_account: buyer_tokens.pubkey(),
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
        data: escrow_global::instruction::Fund {}.data(),
    };
    assert!(process(&mut context, vec![fund_ix.clone()], &[&buyer])
        .await
        .is_err());
    process(
        &mut context,
        vec![accept_ix(&seller.pubkey(), &escrow, terms_hash)],
        &[&seller],
    )
    .await
    .unwrap();
    process(&mut context, vec![fund_ix], &[&buyer])
        .await
        .unwrap();

    let submit_ix = Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::SellerSubmit {
            seller: seller.pubkey(),
            escrow,
        }
        .to_account_metas(None),
        data: escrow_global::instruction::SellerSubmit {
            delivery_hash: [9u8; 32],
        }
        .data(),
    };
    process(&mut context, vec![submit_ix], &[&seller])
        .await
        .unwrap();
    let approve_ix = Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::BuyerApprove {
            buyer: buyer.pubkey(),
            escrow,
        }
        .to_account_metas(None),
        data: escrow_global::instruction::BuyerApprove {}.data(),
    };
    process(&mut context, vec![approve_ix], &[&buyer])
        .await
        .unwrap();

    let fee_ix = Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::ClaimFee {
            fee_recipient: fee.pubkey(),
            escrow,
            mint: mint,
            vault,
            fee_token_account: fee_tokens.pubkey(),
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
        data: escrow_global::instruction::ClaimFee {}.data(),
    };
    assert!(process(&mut context, vec![fee_ix.clone()], &[&fee])
        .await
        .is_err());
    let seller_ix = Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::ClaimSeller {
            seller: seller.pubkey(),
            escrow,
            mint: mint,
            vault,
            seller_token_account: seller_tokens.pubkey(),
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
        data: escrow_global::instruction::ClaimSeller {}.data(),
    };
    process(&mut context, vec![seller_ix], &[&seller])
        .await
        .unwrap();
    process(&mut context, vec![fee_ix], &[&fee]).await.unwrap();

    let close_ix = Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::CloseEscrow {
            buyer: buyer.pubkey(),
            escrow,
            mint: mint,
            vault,
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
        data: escrow_global::instruction::CloseEscrow {}.data(),
    };
    process(&mut context, vec![close_ix], &[&buyer])
        .await
        .unwrap();

    assert!(context
        .banks_client
        .get_account(escrow)
        .await
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn bilateral_refund_requires_both_signatures() {
    let (mut context, buyer, seller, arbiter, fee, mint, buyer_tokens, _seller_tokens, _fee_tokens) =
        setup().await;
    let agreement_id_hash = [17u8; 32];
    let terms_hash = [18u8; 32];
    let (escrow, vault) = escrow_addresses(&buyer.pubkey(), &agreement_id_hash);
    process(
        &mut context,
        vec![initialize_ix(
            &buyer,
            &seller,
            &arbiter,
            &fee,
            &mint,
            agreement_id_hash,
            terms_hash,
        )],
        &[&buyer, &arbiter],
    )
    .await
    .unwrap();
    process(
        &mut context,
        vec![accept_ix(&seller.pubkey(), &escrow, terms_hash)],
        &[&seller],
    )
    .await
    .unwrap();
    let fund_ix = Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::Fund {
            buyer: buyer.pubkey(),
            escrow,
            mint: mint,
            vault,
            buyer_token_account: buyer_tokens.pubkey(),
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
        data: escrow_global::instruction::Fund {}.data(),
    };
    process(&mut context, vec![fund_ix], &[&buyer])
        .await
        .unwrap();
    let refund_ix = Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::BilateralRefund {
            buyer: buyer.pubkey(),
            seller: seller.pubkey(),
            escrow,
        }
        .to_account_metas(None),
        data: escrow_global::instruction::BilateralRefund {}.data(),
    };
    assert!(
        process_partial(&mut context, vec![refund_ix.clone()], &[&buyer])
            .await
            .is_err()
    );
    process(&mut context, vec![refund_ix], &[&buyer, &seller])
        .await
        .unwrap();
}

#[tokio::test]
async fn explicit_dispute_requires_original_party_and_fixed_arbiter_outcome() {
    let (mut context, buyer, seller, arbiter, fee, mint, buyer_tokens, seller_tokens, fee_tokens) =
        setup().await;
    let agreement_id_hash = [21u8; 32];
    let terms_hash = [22u8; 32];
    let (escrow, vault) = escrow_addresses(&buyer.pubkey(), &agreement_id_hash);
    process(
        &mut context,
        vec![initialize_ix(
            &buyer,
            &seller,
            &arbiter,
            &fee,
            &mint,
            agreement_id_hash,
            terms_hash,
        )],
        &[&buyer, &arbiter],
    )
    .await
    .unwrap();
    process(
        &mut context,
        vec![accept_ix(&seller.pubkey(), &escrow, terms_hash)],
        &[&seller],
    )
    .await
    .unwrap();
    let fund_ix = Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::Fund {
            buyer: buyer.pubkey(),
            escrow,
            mint: mint,
            vault,
            buyer_token_account: buyer_tokens.pubkey(),
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
        data: escrow_global::instruction::Fund {}.data(),
    };
    process(&mut context, vec![fund_ix], &[&buyer])
        .await
        .unwrap();
    let submit_ix = Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::SellerSubmit {
            seller: seller.pubkey(),
            escrow,
        }
        .to_account_metas(None),
        data: escrow_global::instruction::SellerSubmit {
            delivery_hash: [23u8; 32],
        }
        .data(),
    };
    process(&mut context, vec![submit_ix], &[&seller])
        .await
        .unwrap();
    let open_ix = Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::OpenDispute {
            opener: buyer.pubkey(),
            escrow,
            mint: mint,
            fee_recipient: fee.pubkey(),
            opener_token_account: buyer_tokens.pubkey(),
            fee_token_account: fee_tokens.pubkey(),
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
        data: escrow_global::instruction::OpenDispute {}.data(),
    };
    process(&mut context, vec![open_ix], &[&buyer])
        .await
        .unwrap();
    let resolve_ix = Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::ArbiterResolve {
            arbiter: arbiter.pubkey(),
            escrow,
        }
        .to_account_metas(None),
        data: escrow_global::instruction::ArbiterRelease {}.data(),
    };
    process(&mut context, vec![resolve_ix], &[&arbiter])
        .await
        .unwrap();
    let seller_ix = Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::ClaimSeller {
            seller: seller.pubkey(),
            escrow,
            mint: mint,
            vault,
            seller_token_account: seller_tokens.pubkey(),
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
        data: escrow_global::instruction::ClaimSeller {}.data(),
    };
    process(&mut context, vec![seller_ix], &[&seller])
        .await
        .unwrap();
    let fee_ix = Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::ClaimFee {
            fee_recipient: fee.pubkey(),
            escrow,
            mint: mint,
            vault,
            fee_token_account: fee_tokens.pubkey(),
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
        data: escrow_global::instruction::ClaimFee {}.data(),
    };
    process(&mut context, vec![fee_ix], &[&fee]).await.unwrap();
}

#[tokio::test]
async fn buyer_can_cancel_only_before_funding() {
    let (
        mut context,
        buyer,
        seller,
        arbiter,
        fee,
        mint,
        _buyer_tokens,
        _seller_tokens,
        _fee_tokens,
    ) = setup().await;
    let agreement_id_hash = [27u8; 32];
    let terms_hash = [28u8; 32];
    let (escrow, vault) = escrow_addresses(&buyer.pubkey(), &agreement_id_hash);
    process(
        &mut context,
        vec![initialize_ix(
            &buyer,
            &seller,
            &arbiter,
            &fee,
            &mint,
            agreement_id_hash,
            terms_hash,
        )],
        &[&buyer, &arbiter],
    )
    .await
    .unwrap();
    let cancel_ix = Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::CancelUnfunded {
            buyer: buyer.pubkey(),
            escrow,
            mint: mint,
            vault,
        }
        .to_account_metas(None),
        data: escrow_global::instruction::CancelUnfunded {}.data(),
    };
    process(&mut context, vec![cancel_ix], &[&buyer])
        .await
        .unwrap();
}

#[tokio::test]
async fn common_ground_executes_exact_partial_allocation_and_remainder_resolution() {
    let (mut context, buyer, seller, arbiter, fee, mint, buyer_tokens, seller_tokens, fee_tokens) =
        setup().await;
    let agreement_id_hash = [37u8; 32];
    let terms_hash = [38u8; 32];
    let (escrow, vault) = escrow_addresses(&buyer.pubkey(), &agreement_id_hash);
    process(
        &mut context,
        vec![initialize_ix(
            &buyer,
            &seller,
            &arbiter,
            &fee,
            &mint,
            agreement_id_hash,
            terms_hash,
        )],
        &[&buyer, &arbiter],
    )
    .await
    .unwrap();
    process(
        &mut context,
        vec![accept_ix(&seller.pubkey(), &escrow, terms_hash)],
        &[&seller],
    )
    .await
    .unwrap();
    let fund_ix = Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::Fund {
            buyer: buyer.pubkey(),
            escrow,
            mint: mint,
            vault,
            buyer_token_account: buyer_tokens.pubkey(),
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
        data: escrow_global::instruction::Fund {}.data(),
    };
    process(&mut context, vec![fund_ix], &[&buyer])
        .await
        .unwrap();
    let submit_ix = Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::SellerSubmit {
            seller: seller.pubkey(),
            escrow,
        }
        .to_account_metas(None),
        data: escrow_global::instruction::SellerSubmit {
            delivery_hash: [39u8; 32],
        }
        .data(),
    };
    process(&mut context, vec![submit_ix], &[&seller])
        .await
        .unwrap();

    let nonce = 1u64;
    let proposal = common_ground_address(&escrow, nonce);
    let expires_at = deadline_args().2;
    let propose_ix = Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::ProposeCommonGround {
            proposer: buyer.pubkey(),
            escrow,
            proposal,
            system_program: solana_sdk::system_program::id(),
        }
        .to_account_metas(None),
        data: escrow_global::instruction::ProposeCommonGround {
            proposal_nonce: nonce,
            seller_amount: 300_000_000,
            buyer_principal_refund: 100_000_000,
            expires_at,
        }
        .data(),
    };
    process(&mut context, vec![propose_ix], &[&buyer])
        .await
        .unwrap();
    let approve_ix = Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::ApproveCommonGround {
            approver: seller.pubkey(),
            proposal,
            escrow,
        }
        .to_account_metas(None),
        data: escrow_global::instruction::ApproveCommonGround {}.data(),
    };
    process(&mut context, vec![approve_ix], &[&seller])
        .await
        .unwrap();
    let execute_ix = Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::ExecuteCommonGround {
            cranker: arbiter.pubkey(),
            proposal,
            escrow,
        }
        .to_account_metas(None),
        data: escrow_global::instruction::ExecuteCommonGround {}.data(),
    };
    process(&mut context, vec![execute_ix], &[&arbiter])
        .await
        .unwrap();

    let resolve_ix = Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::ResolveCommonGroundRemainder {
            buyer: buyer.pubkey(),
            seller: seller.pubkey(),
            escrow,
        }
        .to_account_metas(None),
        data: escrow_global::instruction::ResolveCommonGroundRemainder { to_seller: true }.data(),
    };
    process(&mut context, vec![resolve_ix], &[&buyer, &seller])
        .await
        .unwrap();

    let seller_ix = Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::ClaimSeller {
            seller: seller.pubkey(),
            escrow,
            mint: mint,
            vault,
            seller_token_account: seller_tokens.pubkey(),
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
        data: escrow_global::instruction::ClaimSeller {}.data(),
    };
    process(&mut context, vec![seller_ix], &[&seller])
        .await
        .unwrap();
    let fee_ix = Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::ClaimFee {
            fee_recipient: fee.pubkey(),
            escrow,
            mint: mint,
            vault,
            fee_token_account: fee_tokens.pubkey(),
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
        data: escrow_global::instruction::ClaimFee {}.data(),
    };
    process(&mut context, vec![fee_ix], &[&fee]).await.unwrap();
    let buyer_ix = Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::ClaimBuyerRefund {
            buyer: buyer.pubkey(),
            escrow,
            mint: mint,
            vault,
            buyer_token_account: buyer_tokens.pubkey(),
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
        data: escrow_global::instruction::ClaimBuyerRefund {}.data(),
    };
    process(&mut context, vec![buyer_ix], &[&buyer])
        .await
        .unwrap();

    let close_proposal_ix = Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::CloseCommonGroundProposal {
            proposer: buyer.pubkey(),
            escrow,
            proposal,
        }
        .to_account_metas(None),
        data: escrow_global::instruction::CloseCommonGroundProposal {}.data(),
    };
    process(&mut context, vec![close_proposal_ix], &[&buyer])
        .await
        .unwrap();
    let close_ix = Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::CloseEscrow {
            buyer: buyer.pubkey(),
            escrow,
            mint: mint,
            vault,
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
        data: escrow_global::instruction::CloseEscrow {}.data(),
    };
    process(&mut context, vec![close_ix], &[&buyer])
        .await
        .unwrap();
    assert!(context
        .banks_client
        .get_account(escrow)
        .await
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn v2_milestones_settle_independently_and_close_unfunded_siblings() {
    let (mut context, buyer, seller, arbiter, fee, mint, buyer_tokens, seller_tokens, fee_tokens) =
        setup().await;
    let agreement_id_hash = [47u8; 32];
    let terms_hash = [48u8; 32];
    let escrow = v2_escrow_address(&buyer.pubkey(), &agreement_id_hash);
    let deadlines = deadline_args();

    process(
        &mut context,
        vec![initialize_v2_ix(
            &buyer,
            &seller,
            &arbiter,
            &fee,
            &mint,
            agreement_id_hash,
            terms_hash,
            2,
        )],
        &[&buyer, &arbiter],
    )
    .await
    .unwrap();
    process(
        &mut context,
        vec![create_milestone_v2_ix(
            &buyer,
            &escrow,
            &mint,
            0,
            100_000_000,
            deadlines,
            false,
        )],
        &[&buyer],
    )
    .await
    .unwrap();
    process(
        &mut context,
        vec![create_milestone_v2_ix(
            &buyer,
            &escrow,
            &mint,
            1,
            200_000_000,
            deadlines,
            false,
        )],
        &[&buyer],
    )
    .await
    .unwrap();
    process(
        &mut context,
        vec![Instruction {
            program_id: escrow_global::id(),
            accounts: escrow_global::accounts::SellerAcceptV2 {
                seller: seller.pubkey(),
                escrow,
            }
            .to_account_metas(None),
            data: escrow_global::instruction::SellerAcceptV2 { terms_hash }.data(),
        }],
        &[&seller],
    )
    .await
    .unwrap();

    let (milestone0, vault0) = v2_milestone_addresses(&escrow, 0);
    process(
        &mut context,
        vec![Instruction {
            program_id: escrow_global::id(),
            accounts: escrow_global::accounts::FundMilestoneV2 {
                buyer: buyer.pubkey(),
                escrow,
                mint: mint,
                milestone: milestone0,
                vault: vault0,
                buyer_token_account: buyer_tokens.pubkey(),
                token_program: spl_token::id(),
            }
            .to_account_metas(None),
            data: escrow_global::instruction::FundMilestoneV2 {}.data(),
        }],
        &[&buyer],
    )
    .await
    .unwrap();
    process(
        &mut context,
        vec![Instruction {
            program_id: escrow_global::id(),
            accounts: escrow_global::accounts::SellerSubmitMilestoneV2 {
                seller: seller.pubkey(),
                escrow,
                milestone: milestone0,
            }
            .to_account_metas(None),
            data: escrow_global::instruction::SellerSubmitMilestoneV2 {
                delivery_hash: [49u8; 32],
            }
            .data(),
        }],
        &[&seller],
    )
    .await
    .unwrap();
    process(
        &mut context,
        vec![Instruction {
            program_id: escrow_global::id(),
            accounts: escrow_global::accounts::BuyerApproveMilestoneV2 {
                buyer: buyer.pubkey(),
                escrow,
                milestone: milestone0,
            }
            .to_account_metas(None),
            data: escrow_global::instruction::BuyerApproveMilestoneV2 {}.data(),
        }],
        &[&buyer],
    )
    .await
    .unwrap();

    let seller_claim = Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::ClaimMilestoneSellerV2 {
            seller: seller.pubkey(),
            escrow,
            mint: mint,
            milestone: milestone0,
            vault: vault0,
            seller_token_account: seller_tokens.pubkey(),
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
        data: escrow_global::instruction::ClaimMilestoneSellerV2 {}.data(),
    };
    process(&mut context, vec![seller_claim], &[&seller])
        .await
        .unwrap();
    let fee_claim = Instruction {
        program_id: escrow_global::id(),
        accounts: escrow_global::accounts::ClaimMilestoneFeeV2 {
            fee_recipient: fee.pubkey(),
            escrow,
            mint: mint,
            milestone: milestone0,
            vault: vault0,
            fee_token_account: fee_tokens.pubkey(),
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
        data: escrow_global::instruction::ClaimMilestoneFeeV2 {}.data(),
    };
    process(&mut context, vec![fee_claim], &[&fee])
        .await
        .unwrap();
    process(
        &mut context,
        vec![Instruction {
            program_id: escrow_global::id(),
            accounts: escrow_global::accounts::CloseMilestoneV2 {
                buyer: buyer.pubkey(),
                escrow,
                milestone: milestone0,
                mint: mint,
                vault: vault0,
                token_program: spl_token::id(),
            }
            .to_account_metas(None),
            data: escrow_global::instruction::CloseMilestoneV2 {}.data(),
        }],
        &[&buyer],
    )
    .await
    .unwrap();

    let (milestone1, vault1) = v2_milestone_addresses(&escrow, 1);
    assert!(context
        .banks_client
        .get_account(milestone0)
        .await
        .unwrap()
        .is_none());
    assert!(context
        .banks_client
        .get_account(vault0)
        .await
        .unwrap()
        .is_none());
    assert!(context
        .banks_client
        .get_account(milestone1)
        .await
        .unwrap()
        .is_some());
    let escrow_account = context
        .banks_client
        .get_account(escrow)
        .await
        .unwrap()
        .unwrap();
    let multi = escrow_global::MultiEscrow::try_deserialize(&mut &escrow_account.data[..]).unwrap();
    assert_eq!(multi.closed_milestones, 1);
    assert!(multi.state == escrow_global::MultiEscrowState::Accepted);

    // An unfunded sibling remains independently cancellable even after a
    // different milestone has been funded and fully paid. Its vault and
    // milestone rent must be reclaimed before the aggregate can close.
    process(
        &mut context,
        vec![Instruction {
            program_id: escrow_global::id(),
            accounts: escrow_global::accounts::CancelMilestoneV2 {
                buyer: buyer.pubkey(),
                escrow,
                mint: mint,
                milestone: milestone1,
                vault: vault1,
                token_program: spl_token::id(),
            }
            .to_account_metas(None),
            data: escrow_global::instruction::CancelMilestoneV2 {}.data(),
        }],
        &[&buyer],
    )
    .await
    .unwrap();
    let escrow_account = context
        .banks_client
        .get_account(escrow)
        .await
        .unwrap()
        .unwrap();
    let multi = escrow_global::MultiEscrow::try_deserialize(&mut &escrow_account.data[..]).unwrap();
    assert_eq!(multi.closed_milestones, 2);
    assert!(multi.state == escrow_global::MultiEscrowState::Closed);
    assert!(context
        .banks_client
        .get_account(milestone1)
        .await
        .unwrap()
        .is_none());
    assert!(context
        .banks_client
        .get_account(vault1)
        .await
        .unwrap()
        .is_none());

    process(
        &mut context,
        vec![Instruction {
            program_id: escrow_global::id(),
            accounts: escrow_global::accounts::CloseEscrowV2 {
                buyer: buyer.pubkey(),
                escrow,
            }
            .to_account_metas(None),
            data: escrow_global::instruction::CloseEscrowV2 {}.data(),
        }],
        &[&buyer],
    )
    .await
    .unwrap();
    assert!(context
        .banks_client
        .get_account(escrow)
        .await
        .unwrap()
        .is_none());
}
