import { AptosAccount } from "./aptos_account";
import { TokenClient } from "./token_client";
import { AptosClient } from "./aptos_client";
import { FaucetClient } from "./faucet_client";
import { HexString, MaybeHexString } from "./hex_string";
import { Types } from "./types";
import * as bip39 from "@scure/bip39";
import * as english from "@scure/bip39/wordlists/english";

import fetch from "cross-fetch";

export interface TokenId {
  creator: string;
  collectionName: string;
  name: string;
}

/** A wrapper around the Aptos-core Rest API */
export class RestClient {
  client: AptosClient;
  constructor(url: string) {
    this.client = new AptosClient(url);
  }

  async accountSentEvents(accountAddress: string) {
    return await this.client.getEventsByEventHandle(
      accountAddress,
      "0x1::TestCoin::TransferEvents",
      "sent_events"
    );
  }

  async accountReceivedEvents(accountAddress: string) {
    return await this.client.getEventsByEventHandle(
      accountAddress,
      "0x1::TestCoin::TransferEvents",
      "received_events"
    );
  }

  async transactionPending(txnHash: string): Promise<boolean> {
    return this.client.transactionPending(txnHash);
  }

  /** Waits up to 10 seconds for a transaction to move past pending state */
  async waitForTransaction(txnHash: string) {
    return this.client.waitForTransaction(txnHash);
  }

  /** Returns the test coin balance associated with the account */
  async accountBalance(accountAddress: string): Promise<number | null> {
    const resources: any = await this.client.getAccountResources(
      accountAddress
    );
    for (const key in resources) {
      const resource = resources[key];
      if (resource["type"] == "0x1::TestCoin::Balance") {
        return parseInt(resource["data"]["coin"]["value"]);
      }
    }
    return null;
  }

  /** Transfer a given coin amount from a given Account to the recipient's account address.
     Returns the sequence number of the transaction used to transfer. */
  async transfer(
    accountFrom: AptosAccount,
    recipient: string,
    amount: number
  ): Promise<string> {
    const payload: {
      function: string;
      arguments: string[];
      type: string;
      type_arguments: any[];
    } = {
      type: "script_function_payload",
      function: "0x1::TestCoin::transfer",
      type_arguments: [],
      arguments: [`${HexString.ensure(recipient)}`, amount.toString()],
    };
    const txnRequest = await this.client.generateTransaction(
      accountFrom.address(),
      payload
    );
    const signedTxn = await this.client.signTransaction(
      accountFrom,
      txnRequest
    );
    const res = await this.client.submitTransaction(accountFrom, signedTxn);
    return res["hash"].toString();
  }
}

export class WalletClient {
  faucetClient: FaucetClient;
  restClient: RestClient;
  aptosClient: AptosClient;
  tokenClient: TokenClient;

  constructor(node_url, faucet_url) {
    this.faucetClient = new FaucetClient(node_url, faucet_url);
    this.aptosClient = new AptosClient(node_url);
    this.restClient = new RestClient(node_url);
    this.tokenClient = new TokenClient(this.aptosClient);
  }

  async getAccountFromMnemonic(code: string, address?: MaybeHexString) {
    if (!bip39.validateMnemonic(code, english.wordlist)) {
      return Promise.reject("Incorrect mnemonic passed");
    }

    var seed = bip39.mnemonicToSeedSync(code.toString());

    const account = new AptosAccount(seed.slice(0, 32), address);
    return Promise.resolve(account);
  }

  async createWallet() {
    var code = bip39.generateMnemonic(english.wordlist); // secret recovery phrase
    const account = await this.getAccountFromMnemonic(code).catch((msg) => {
      return Promise.reject(msg);
    });
    await this.faucetClient.fundAccount(account.authKey(), 10);

    return Promise.resolve({
      code: code,
      "address key": account.address().noPrefix(),
    });
  }

  async getUninitializedAccount() {
    var code = bip39.generateMnemonic(english.wordlist); // secret recovery phrase
    const account = await this.getAccountFromMnemonic(code).catch((msg) => {
      return Promise.reject(msg);
    });

    return Promise.resolve({
      code: code,
      auth_key: account.authKey(),
      "address key": account.address().noPrefix(),
    });
  }

  async importWallet(code: string, address?: string) {
    const account = await this.getAccountFromMnemonic(code, address).catch(
      (msg) => {
        return Promise.reject(msg);
      }
    );

    await this.faucetClient.fundAccount(account.authKey(), 10);

    return Promise.resolve({
      auth_key: account.authKey(),
      "address key": account.address().noPrefix(),
    });
  }

  async airdrop(address: string, amount: number) {
    return await this.faucetClient.fundAccount(address, amount);
  }

  async getBalance(address: string) {
    var balance = await this.restClient.accountBalance(address);
    return Promise.resolve(balance);
  }

  async transfer(
    code: string,
    recipient_address: string,
    amount: number,
    sender_address?: string
  ) {
    const account = await this.getAccountFromMnemonic(
      code,
      sender_address
    ).catch((msg) => {
      return Promise.reject(msg);
    });

    const txHash = await this.restClient.transfer(
      account,
      recipient_address,
      amount
    );
    await this.restClient
      .waitForTransaction(txHash)
      .then(() => Promise.resolve(true))
      .catch((msg) => Promise.reject(msg));
  }

  async getSentEvents(address: string) {
    return await this.restClient.accountSentEvents(address);
  }

  async getReceivedEvents(address: string) {
    return await this.restClient.accountReceivedEvents(address);
  }

  async createNFTCollection(
    code: string,
    name: string,
    description: string,
    uri: string,
    address?: string
  ) {
    const account = await this.getAccountFromMnemonic(code, address).catch(
      (msg) => {
        return Promise.reject(msg);
      }
    );

    return await this.tokenClient.createCollection(
      account,
      name,
      description,
      uri
    );
  }

  async createNFT(
    code: string,
    collection_name: string,
    name: string,
    description: string,
    supply: number,
    uri: string,
    address?: string
  ) {
    const account = await this.getAccountFromMnemonic(code, address).catch(
      (msg) => {
        return Promise.reject(msg);
      }
    );

    return await this.tokenClient.createToken(
      account,
      collection_name,
      name,
      description,
      supply,
      uri
    );
  }

  async offerNFT(
    code: string,
    receiver_address: string,
    creator_address: string,
    collection_name: string,
    token_name: string,
    amount: number,
    address?: string
  ) {
    const account = await this.getAccountFromMnemonic(code, address).catch(
      (msg) => {
        return Promise.reject(msg);
      }
    );

    return await this.tokenClient.offerToken(
      account,
      receiver_address,
      creator_address,
      collection_name,
      token_name,
      amount
    );
  }

  async cancelNFTOffer(
    code: string,
    receiver_address: string,
    creator_address: string,
    collection_name: string,
    token_name: string,
    address?: string
  ) {
    const account = await this.getAccountFromMnemonic(code, address).catch(
      (msg) => {
        return Promise.reject(msg);
      }
    );

    const token_id = await this.tokenClient.getTokenId(
      creator_address,
      collection_name,
      token_name
    );

    return await this.tokenClient.cancelTokenOffer(
      account,
      receiver_address,
      creator_address,
      token_id
    );
  }

  async claimNFT(
    code: string,
    sender_address: string,
    creator_address: string,
    collection_name: string,
    token_name: string,
    address?: string
  ) {
    const account = await this.getAccountFromMnemonic(code, address).catch(
      (msg) => {
        return Promise.reject(msg);
      }
    );

    return await this.tokenClient.claimToken(
      account,
      sender_address,
      creator_address,
      collection_name,
      token_name
    );
  }

  async signGenericTransaction(
    code: string,
    func: string,
    address?: string,
    ...args: string[]
  ) {
    const account = await this.getAccountFromMnemonic(code, address).catch(
      (msg) => {
        return Promise.reject(msg);
      }
    );

    const payload: {
      function: string;
      arguments: string[];
      type: string;
      type_arguments: any[];
    } = {
      type: "script_function_payload",
      function: func,
      type_arguments: [],
      arguments: args,
    };
    return await this.tokenClient.submitTransactionHelper(account, payload);
  }

  async getAccountResources(
    accountAddress: string
  ): Promise<Types.AccountResource[]> {
    return await this.aptosClient.getAccountResources(accountAddress);
  }

  // async rotateAuthKey(code: string, currAddress: string) {

  //     const alice = await this.getAccountFromMnemonic(code, currAddress).catch((msg) => {
  //         return Promise.reject(msg);
  //     });

  //     const newKeys = await this.getUninitializedAccount();

  //     const payload2: { function: string; arguments: string[]; type: string; type_arguments: any[] } = {
  //         type: "script_function_payload",
  //         function: "0x1::AptosAccount::rotate_authentication_key",
  //         type_arguments: [],
  //         arguments: [
  //             new_auth_key,
  //         ]
  //     }
  //     await this.tokenClient.submitTransactionHelper(oldAlice, payload2);

  //     const payload: { function: string; arguments: string[]; type: string; type_arguments: any[] } = {
  //         type: "script_function_payload",
  //         function: "0x3e4eeee8e135792f991d107eb92d927e12d811a587df2c13523c548754a24c3a::MartianWallet::set_address",
  //         type_arguments: [],
  //         arguments: [
  //           `0x${currAddress}`,
  //         ]
  //     }
  //     return await this.tokenClient.submitTransactionHelper(newAlice, payload);
  // }

  // /** Retrieve the collection **/
  // async getCollection(creator: string, collection_name: string): Promise<number> {
  //     const resources: Types.AccountResource[] = await this.aptosClient.getAccountResources(creator);
  //     const accountResource: { type: string; data: any } = resources.find((r) => r.type === "0x1::Token::Collections");
  //     let collection = await this.tokenClient.tableItem(
  //         accountResource.data.collections.handle,
  //         "0x1::ASCII::String",
  //         "0x1::Token::Collection",
  //         collection_name,
  //     );
  //     return collection
  // }

  // // /** Retrieve the token **/
  // async getTokens(creator: string, collection_name: string, token_name: string): Promise<number> {
  //     v tokens = []

  //     const resources: Types.AccountResource[] = await this.aptosClient.getAccountResources(creator);
  //     const accountResource: { type: string; data: any } = resources.find((r) => r.type === "0x1::Token::Collections");
  //     let collection = await this.tokenClient.tableItem(
  //         accountResource.data.collections.handle,
  //         "0x1::ASCII::String",
  //         "0x1::Token::Collection",
  //         collection_name,
  //     );
  //     let tokenData = await this.tokenClient.tableItem(
  //         collection["tokens"]["handle"],
  //         "0x1::ASCII::String",
  //         "0x1::Token::TokenData",
  //         token_name,
  //     );
  //     return tokenData["id"]["creation_num"]
  // }

  async getEventStream(
    address: string,
    eventHandleStruct: string,
    fieldName: string
  ) {
    const response = await fetch(
      `${this.aptosClient.nodeUrl}/accounts/${address}/events/${eventHandleStruct}/${fieldName}`,
      {
        method: "GET",
      }
    );

    if (response.status == 404) {
      console.log("Status 404 while getEventStream", response.json());
      return [];
    }

    return await response.json();
  }

  // returns a list of token IDs of the tokens in a user's account (including the tokens that were minted)
  async getTokenIds(
    address: string,
    getAll: boolean = false,
    getMinted: boolean = false
  ) {
    const depositEvents = await this.getEventStream(
      address,
      "0x1::Token::TokenStore",
      "deposit_events"
    );
    const withdrawEvents = await this.getEventStream(
      address,
      "0x1::Token::TokenStore",
      "withdraw_events"
    );
    function isEventEqual(event1, event2) {
      return (
        event1.data.id.creator === event2.data.id.creator &&
        event1.data.id.collectionName === event2.data.id.collectionName &&
        event1.data.id.name === event2.data.id.name
      );
    }
    var tokenIds = [];

    if (getAll) {
      for (var elem of depositEvents) {
        tokenIds.push(elem.data.id);
      }
      return tokenIds;
    }

    if (getMinted) {
      for (var elem of depositEvents) {
        if (elem.data.id.creator === `0x${address}`) {
          tokenIds.push(elem.data.id);
        }
      }
      return tokenIds
    }

    for (var elem of depositEvents) {
      if (
        !withdrawEvents.some(function (item) {
          return isEventEqual(item, elem);
        })
      ) {
        tokenIds.push(elem.data.id);
      }
    }
    return tokenIds;
  }

  async getOwnedTokens(address: string) {
    const tokenIds = await this.getTokenIds(address, false, false);
    var tokens = [];
    for (var tokenId of tokenIds) {
      const resources: Types.AccountResource[] =
        await this.aptosClient.getAccountResources(tokenId.creator);
      const accountResource: { type: string; data: any } = resources.find(
        (r) => r.type === "0x1::Token::Collections"
      );
      let token = await this.tokenClient.tableItem(
        accountResource.data.token_data.handle,
        "0x1::Token::TokenId",
        "0x1::Token::TokenData",
        tokenId
      );
      tokens.push(token);
    }
    return tokens;
  }

  async getCreatedTokens(address: string) {
    const tokenIds = await this.getTokenIds(address, false, true);
    var tokens = [];
    for (var tokenId of tokenIds) {
      const resources: Types.AccountResource[] =
        await this.aptosClient.getAccountResources(tokenId.creator);
      const accountResource: { type: string; data: any } = resources.find(
        (r) => r.type === "0x1::Token::Collections"
      );
      let token = await this.tokenClient.tableItem(
        accountResource.data.token_data.handle,
        "0x1::Token::TokenId",
        "0x1::Token::TokenData",
        tokenId
      );
      tokens.push(token);
    }
    return tokens;
  }

  async getTokens(address: string) {
    const tokenIds = await this.getTokenIds(address, true);
    var tokens = [];
    for (var tokenId of tokenIds) {
      const resources: Types.AccountResource[] =
        await this.aptosClient.getAccountResources(tokenId.creator);
      const accountResource: { type: string; data: any } = resources.find(
        (r) => r.type === "0x1::Token::Collections"
      );
      let token = await this.tokenClient.tableItem(
        accountResource.data.token_data.handle,
        "0x1::Token::TokenId",
        "0x1::Token::TokenData",
        tokenId
      );
      tokens.push(token);
    }
    return tokens;
  }

  async getToken(tokenId: TokenId) {
    const resources: Types.AccountResource[] =
      await this.aptosClient.getAccountResources(tokenId.creator);
    const accountResource: { type: string; data: any } = resources.find(
      (r) => r.type === "0x1::Token::Collections"
    );
    let token = await this.tokenClient.tableItem(
      accountResource.data.token_data.handle,
      "0x1::Token::TokenId",
      "0x1::Token::TokenData",
      tokenId
    );
    return token;
  }

  // returns the collection data of a user
  async getCollection(address: string, collectionName: string) {
    const resources: Types.AccountResource[] =
      await this.aptosClient.getAccountResources(address);
    const accountResource: { type: string; data: any } = resources.find(
      (r) => r.type === "0x1::Token::Collections"
    );
    let collection = await this.tokenClient.tableItem(
      accountResource.data.token_data.handle,
      "ASCII::String",
      "0x1::Token::Collections",
      collectionName
    );
    return collection;
  }

  async getCustomResource(
    address: string,
    resourceType: string,
    fieldName: string,
    keyType: string,
    valueType: string,
    key: any
  ) {
    const resources: Types.AccountResource[] =
      await this.aptosClient.getAccountResources(address);
    const accountResource: { type: string; data: any } = resources.find(
      (r) => r.type === resourceType
    );
    let resource = await this.tokenClient.tableItem(
      accountResource.data[fieldName].handle,
      keyType,
      valueType,
      key
    );
    return resource;
  }
}
