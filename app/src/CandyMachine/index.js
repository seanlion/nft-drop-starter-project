import React, { useCallback, useEffect, useState } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';
import { Program, Provider, web3 } from '@project-serum/anchor';
import { MintLayout, TOKEN_PROGRAM_ID, Token } from '@solana/spl-token';
import { sendTransactions } from './connection';
import './CandyMachine.css';
import {
  candyMachineProgram,
  TOKEN_METADATA_PROGRAM_ID,
  SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID,
  getAtaForMint,
  getNetworkExpire,
  getNetworkToken,
  CIVIC
} from './helpers';
import CountdownTimer from '../CountdownTimer';

const { SystemProgram } = web3;
const opts = {
  preflightCommitment: 'processed',
};

const CandyMachine = ({ walletAddress }) => {

  const [timerString, setTimerString] = useState('');
  const [candyMachineObj, setCandyMachineObj] = useState(null);

  const getProvider = () => {
    const rpcHost = process.env.REACT_APP_SOLANA_RPC_HOST;
    const connection = new Connection(rpcHost);
    const provider = new Provider (
      connection,
      window.solana,
      opts.preflightCommitment
    );
    return provider;
  };

  const getCandyMachineState = useCallback(async () => {
    const provider = getProvider();
    // candyMachine program으로부터 metadata 가져오기
    const idl = await Program.fetchIdl(candyMachineProgram, provider);
    // 이 프로그램의 메소드들을 호출하기 위해 프로그램 생성.
    const program = new Program(idl, candyMachineProgram, provider);
    // 주소로 계정 가져오기
    const candyMachine = await program.account.candyMachine.fetch(process.env.REACT_APP_CANDY_MACHINE_ID);
    // 계정에서 메타 데이터 가져오기(account.data는 어떻게 접근했을까?)
    // metaplex/js/candy-machine.ts 참고
    const itemsAvailable = candyMachine.data.itemsAvailable.toNumber();
    const itemsRedeemed = candyMachine.itemsRedeemed.toNumber();
    const itemsRemaining = itemsAvailable - itemsRedeemed;
    const goLiveDate = candyMachine.data.goLiveDate.toNumber();
    const presale = 
      candyMachine.data.whitelistMintSettings && // 객체에도 '&&'를 쓸 수 있음.
      candyMachine.data.whitelistMintSettings.presale && // boolean 값.
      (!candyMachine.data.goLiveDate || // anchor Big Number 타입
        candyMachine.data.goLiveDate.toNumber() > new Date().getTime() / 1000);
    const goLiveDateTimeString = `${new Date(goLiveDate * 1000).toGMTString()}`

    // candy Machine render하게 data set
    setCandyMachineObj({
      id: process.env.REACT_APP_CANDY_MACHINE_ID,
      program,
      state: {
        itemsAvailable,
        itemsRedeemed,
        itemsRemaining,
        goLiveDate,
        goLiveDateTimeString,
        isSoldOut: itemsRemaining === 0,
        isActive: (presale ||
          candyMachine.data.goLiveDate.toNumber() < new Date().getTime() / 1000) &&
          (candyMachine.endSettings
            ? candyMachine.endSettings.endSettingType.date
              ? candyMachine.endSettings.number.toNumber() > new Date().getTime() / 1000
              : itemsRedeemed < candyMachine.endSettings.number.toNumber()
            : true),
        isPresale: presale,
        treasury: candyMachine.wallet,
        tokenMint: candyMachine.tokenMint,
        gatekeepr: candyMachine.data.gatekeeper,
        endSettings: candyMachine.data.endSettings,
        whitelistMintSettings: candyMachine.data.whitelistMintSettings,
        hiddenSettings: candyMachine.data.hiddenSettings,
        price: candyMachine.data.price,
      },
    });

    console.log({
      itemsAvailable,
      itemsRedeemed,
      itemsRemaining,
      goLiveDate,
      goLiveDateTimeString,
      presale
    });
  }, []);

  const getCandyMachineCreator = async (candyMachine) => {
    const candyMachineID = new PublicKey(candyMachine);
    return await web3.PublicKey.findProgramAddress(
        [Buffer.from('candy_machine'), candyMachineID.toBuffer()],
        candyMachineProgram,
    );
  };

  const getMetadata = async (mint) => {
    return (
      await PublicKey.findProgramAddress(
        [
          Buffer.from('metadata'),
          TOKEN_METADATA_PROGRAM_ID.toBuffer(),
          mint.toBuffer(),
        ],
        TOKEN_METADATA_PROGRAM_ID
      )
    )[0];
  };

  const getMasterEdition = async (mint) => {
    return (
      await PublicKey.findProgramAddress(
        [
          Buffer.from('metadata'),
          TOKEN_METADATA_PROGRAM_ID.toBuffer(),
          mint.toBuffer(),
          Buffer.from('edition'),
        ],
        TOKEN_METADATA_PROGRAM_ID
      )
    )[0];
  };
  
  const createAssociatedTokenAccountInstruction = (
    associatedTokenAddress,
    payer,
    walletAddress,
    splTokenMintAddress
  ) => {
    const keys = [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedTokenAddress, isSigner: false, isWritable: true },
      { pubkey: walletAddress, isSigner: false, isWritable: false },
      { pubkey: splTokenMintAddress, isSigner: false, isWritable: false },
      {
        pubkey: web3.SystemProgram.programId,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      {
        pubkey: web3.SYSVAR_RENT_PUBKEY,
        isSigner: false,
        isWritable: false,
      },
    ];
    return new web3.TransactionInstruction({
      keys,
      programId: SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID,
      data: Buffer.from([]),
    });
  };

  const mintToken = async (candyMachineObj) => {
    const mint = web3.Keypair.generate();

    const userTokenAccountAddress = (
      await getAtaForMint(mint.publicKey, walletAddress.publicKey)
    )[0];
    console.log("candyMachine.state : ", candyMachineObj.state);
    const userPayingAccountAddress = candyMachineObj.state.tokenMint
      ? (await getAtaForMint(candyMachineObj.state.tokenMint, walletAddress.publicKey))[0]
      : walletAddress.publicKey;
  
    const candyMachineAddress = candyMachineObj.id;
    const remainingAccounts = [];
    const signers = [mint];
    const cleanupInstructions = [];
    const instructions = [
      web3.SystemProgram.createAccount({
        fromPubkey: walletAddress.publicKey, // 만든 NFT 계정에 램포트 보낼 계정
        newAccountPubkey: mint.publicKey, // 만드는 계정
        space: MintLayout.span, // 여기에 얼만큼 바이트 할당할지
        lamports:
          await candyMachineObj.program.provider.connection.getMinimumBalanceForRentExemption( // 솔라나 RentExemption 할만큼만 보내자.
            MintLayout.span,
          ),
        programId: TOKEN_PROGRAM_ID,
      }),
      Token.createInitMintInstruction(
        TOKEN_PROGRAM_ID,
        mint.publicKey,
        0,
        walletAddress.publicKey,
        walletAddress.publicKey,
      ),
      createAssociatedTokenAccountInstruction(
        userTokenAccountAddress,
        walletAddress.publicKey,
        walletAddress.publicKey,
        mint.publicKey,
      ),
      Token.createMintToInstruction(
        TOKEN_PROGRAM_ID,
        mint.publicKey,
        userTokenAccountAddress, // 민팅할 유저가 가진 토큰 계정으로 보내기
        walletAddress.publicKey,
        [],
        1,
      ),
    ];
  
    if (candyMachineObj.state.gatekeeper) {
    remainingAccounts.push({
        pubkey: (
          await getNetworkToken(
            walletAddress.publicKey,
            candyMachineObj.state.gatekeeper.gatekeeperNetwork,
          )
        )[0],
        isWritable: true,
        isSigner: false,
      });
      if (candyMachineObj.state.gatekeeper.expireOnUse) {
        remainingAccounts.push({
          pubkey: CIVIC,
          isWritable: false,
          isSigner: false,
        });
        remainingAccounts.push({
          pubkey: (
            await getNetworkExpire(
              candyMachineObj.state.gatekeeper.gatekeeperNetwork,
            )
          )[0],
          isWritable: false,
          isSigner: false,
        });
      }
    }
    if (candyMachineObj.state.whitelistMintSettings) {
      const mint = new web3.PublicKey(
        candyMachineObj.state.whitelistMintSettings.mint,
      );
  
      const whitelistToken = (await getAtaForMint(mint, walletAddress.publicKey))[0];
      remainingAccounts.push({
        pubkey: whitelistToken,
        isWritable: true,
        isSigner: false,
      });
  
      if (candyMachineObj.state.whitelistMintSettings.mode.burnEveryTime) {
        const whitelistBurnAuthority = web3.Keypair.generate();
  
        remainingAccounts.push({
          pubkey: mint,
          isWritable: true,
          isSigner: false,
        });
        remainingAccounts.push({
          pubkey: whitelistBurnAuthority.publicKey,
          isWritable: false,
          isSigner: true,
        });
        signers.push(whitelistBurnAuthority);
        const exists =
          await candyMachineObj.program.provider.connection.getAccountInfo(
            whitelistToken,
          );
        if (exists) {
          instructions.push(
            Token.createApproveInstruction(
              TOKEN_PROGRAM_ID,
              whitelistToken,
              whitelistBurnAuthority.publicKey,
              walletAddress.publicKey,
              [],
              1,
            ),
          );
          cleanupInstructions.push(
            Token.createRevokeInstruction(
              TOKEN_PROGRAM_ID,
              whitelistToken,
              walletAddress.publicKey,
              [],
            ),
          );
        }
      }
    }
  
    if (candyMachineObj.state.tokenMint) {
      const transferAuthority = web3.Keypair.generate();
  
      signers.push(transferAuthority);
      remainingAccounts.push({
        pubkey: userPayingAccountAddress,
        isWritable: true,
        isSigner: false,
      });
      remainingAccounts.push({
        pubkey: transferAuthority.publicKey,
        isWritable: false,
        isSigner: true,
      });
  
      instructions.push(
        Token.createApproveInstruction(
          TOKEN_PROGRAM_ID,
          userPayingAccountAddress,
          transferAuthority.publicKey,
          walletAddress.publicKey,
          [],
          candyMachineObj.state.price.toNumber(),
        ),
      );
      cleanupInstructions.push(
        Token.createRevokeInstruction(
          TOKEN_PROGRAM_ID,
          userPayingAccountAddress,
          walletAddress.publicKey,
          [],
        ),
      );
    }
    const metadataAddress = await getMetadata(mint.publicKey);
    const masterEdition = await getMasterEdition(mint.publicKey);
  
    const [candyMachineCreator, creatorBump] = await getCandyMachineCreator(
      candyMachineAddress,
    );
  
    instructions.push(
      await candyMachineObj.program.instruction.mintNft(creatorBump, {
        accounts: {
          candyMachine: candyMachineAddress,
          candyMachineCreator,
          payer: walletAddress.publicKey,
          wallet: candyMachineObj.state.treasury,
          mint: mint.publicKey,
          metadata: metadataAddress,
          masterEdition,
          mintAuthority: walletAddress.publicKey,
          updateAuthority: walletAddress.publicKey,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: web3.SYSVAR_RENT_PUBKEY,
          clock: web3.SYSVAR_CLOCK_PUBKEY,
          recentBlockhashes: web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
          instructionSysvarAccount: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        },
        remainingAccounts:
          remainingAccounts.length > 0 ? remainingAccounts : undefined,
      }),
    );
  
    try {
      return (
        await sendTransactions(
          candyMachineObj.program.provider.connection,
          candyMachineObj.program.provider.wallet,
          [instructions, cleanupInstructions],
          [signers, []],
          )
      ).txs.map(t => t.txid);
    } catch (e) {
      console.log(e);
    }
    return [];
  };
  
  // Create render function
  const renderDropTimer = () => {
    // Get the current date and dropDate in a JavaScript Date object
    const currentDate = new Date();
    const dropDate = new Date(candyMachineObj.state.goLiveDate * 1000)
    // If currentDate is before dropDate, render our Countdown component
    if (currentDate < dropDate) {
      console.log('Before drop date!');
      // Don't forget to pass over your dropDate!
      return <CountdownTimer dropDate={dropDate} timerString={timerString} />;
    }

    // Else let's just return the current drop date
    return <p>{`Drop Date: ${candyMachineObj.state.goLiveDateTimeString}`}</p>;
  };

  useEffect( () => {
    getCandyMachineState();
  }, [getCandyMachineState]);

  //Our useEffect will run on component load
  useEffect(() => {
    console.log('Setting interval...');
    if (!candyMachineObj) return;
    // Use setInterval to run this piece of code every second
    const interval = setInterval(() => {
      const currentDate = new Date().getTime();
      const dropDate = new Date(candyMachineObj.state.goLiveDate * 1000)
      const distance = dropDate - currentDate;

      // Here it's as easy as doing some time math to get the different properties
      const days = Math.floor(distance / (1000 * 60 * 60 * 24));
      const hours = Math.floor(
        (distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
      );
      const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((distance % (1000 * 60)) / 1000);

      // We have our desired output, set it in state!
      setTimerString(`${days}d ${hours}h ${minutes}m ${seconds}s`);

      // If our distance passes zero this means that it's drop time!
      if (distance < 0) {
        console.log('Clearing interval...');
        clearInterval(interval);
      }
    }, 1000);

    // Anytime our component unmounts let's clean up our interval
    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [candyMachineObj]); 

  return (
    candyMachineObj && (
    <div className="machine-container">
      {/* Add this at the beginning of our component */}
      {renderDropTimer()}
      <p>{`Items Minted: ${candyMachineObj.state.itemsRedeemed} / ${candyMachineObj.state.itemsAvailable}`}</p>
      {candyMachineObj.state.itemsRedeemed === candyMachineObj.state.itemsAvailable ? (
          <p className="sub-text">Sold Out 🙊</p>
      ) : (
        <button className="cta-button mint-button" onClick={() => mintToken(candyMachineObj)}>
          Mint NFT
        </button>
      )}
    </div>
    )
  );
};

export default CandyMachine;
