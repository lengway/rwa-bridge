/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/plain_markets.json`.
 */
export type PlainMarkets = {
  "address": "H87kwrjtpNKxqbydmjW7ytnX7Jum7RramAaiyc82XMVm",
  "metadata": {
    "name": "plainMarkets",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Plain Markets: on-chain corporate-actions servicing engine for tokenized bonds"
  },
  "instructions": [
    {
      "name": "allowHolder",
      "discriminator": [
        176,
        1,
        245,
        90,
        146,
        217,
        110,
        85
      ],
      "accounts": [
        {
          "name": "issuer",
          "writable": true,
          "signer": true,
          "relations": [
            "instrument"
          ]
        },
        {
          "name": "instrument"
        },
        {
          "name": "allowEntry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  108,
                  108,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "instrument"
              },
              {
                "kind": "arg",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "wallet",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "announce",
      "discriminator": [
        7,
        30,
        100,
        250,
        110,
        253,
        3,
        149
      ],
      "accounts": [
        {
          "name": "issuer",
          "writable": true,
          "signer": true,
          "relations": [
            "instrument"
          ]
        },
        {
          "name": "instrument",
          "writable": true
        },
        {
          "name": "action",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "instrument"
              },
              {
                "kind": "account",
                "path": "instrument.actionCount",
                "account": "instrument"
              }
            ]
          }
        },
        {
          "name": "vault",
          "docs": [
            "Paying vault [b\"vault\", action], owned by the action PDA. Required for paying actions,",
            "omitted for votes."
          ],
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "action"
              }
            ]
          }
        },
        {
          "name": "settlementMint",
          "optional": true
        },
        {
          "name": "settlementTokenProgram",
          "optional": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "announceParams"
            }
          }
        }
      ]
    },
    {
      "name": "cancelAction",
      "discriminator": [
        228,
        144,
        170,
        146,
        66,
        88,
        133,
        128
      ],
      "accounts": [
        {
          "name": "issuer",
          "writable": true,
          "signer": true,
          "relations": [
            "instrument"
          ]
        },
        {
          "name": "instrument",
          "writable": true,
          "relations": [
            "action"
          ]
        },
        {
          "name": "action",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "instrument"
              },
              {
                "kind": "account",
                "path": "action.id",
                "account": "corporateAction"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "action"
              }
            ]
          }
        },
        {
          "name": "issuerSettlement",
          "writable": true,
          "optional": true
        },
        {
          "name": "settlementMint",
          "optional": true
        },
        {
          "name": "settlementTokenProgram",
          "optional": true
        }
      ],
      "args": []
    },
    {
      "name": "castVote",
      "discriminator": [
        20,
        212,
        15,
        189,
        69,
        180,
        69,
        151
      ],
      "accounts": [
        {
          "name": "holder",
          "writable": true,
          "signer": true
        },
        {
          "name": "instrument",
          "relations": [
            "action"
          ]
        },
        {
          "name": "action",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "instrument"
              },
              {
                "kind": "account",
                "path": "action.id",
                "account": "corporateAction"
              }
            ]
          }
        },
        {
          "name": "voteRecord",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  111,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "action"
              },
              {
                "kind": "account",
                "path": "holder"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "units",
          "type": "u64"
        },
        {
          "name": "proof",
          "type": {
            "vec": {
              "array": [
                "u8",
                32
              ]
            }
          }
        },
        {
          "name": "choice",
          "type": "u8"
        }
      ]
    },
    {
      "name": "claim",
      "discriminator": [
        62,
        198,
        214,
        193,
        213,
        159,
        108,
        210
      ],
      "accounts": [
        {
          "name": "holder",
          "writable": true,
          "signer": true
        },
        {
          "name": "instrument",
          "writable": true,
          "relations": [
            "action"
          ]
        },
        {
          "name": "action",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "instrument"
              },
              {
                "kind": "account",
                "path": "action.id",
                "account": "corporateAction"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "action"
              }
            ]
          }
        },
        {
          "name": "holderSettlement",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "holder"
              },
              {
                "kind": "account",
                "path": "settlementTokenProgram"
              },
              {
                "kind": "account",
                "path": "settlementMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "mint",
          "docs": [
            "Bond mint (burned from on redemptions)."
          ],
          "writable": true,
          "relations": [
            "instrument"
          ]
        },
        {
          "name": "holderBond",
          "docs": [
            "Holder's bond token account; required for redemptions."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "receipt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  108,
                  97,
                  105,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "action"
              },
              {
                "kind": "account",
                "path": "holder"
              }
            ]
          }
        },
        {
          "name": "settlementMint",
          "relations": [
            "instrument"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "settlementTokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "units",
          "type": "u64"
        },
        {
          "name": "proof",
          "type": {
            "vec": {
              "array": [
                "u8",
                32
              ]
            }
          }
        }
      ]
    },
    {
      "name": "disallowHolder",
      "discriminator": [
        76,
        111,
        18,
        136,
        75,
        243,
        78,
        101
      ],
      "accounts": [
        {
          "name": "issuer",
          "writable": true,
          "signer": true,
          "relations": [
            "instrument"
          ]
        },
        {
          "name": "instrument",
          "relations": [
            "allowEntry"
          ]
        },
        {
          "name": "allowEntry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  108,
                  108,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "instrument"
              },
              {
                "kind": "account",
                "path": "allowEntry.wallet",
                "account": "allowEntry"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "fund",
      "discriminator": [
        218,
        188,
        111,
        221,
        152,
        113,
        174,
        7
      ],
      "accounts": [
        {
          "name": "issuer",
          "writable": true,
          "signer": true,
          "relations": [
            "instrument"
          ]
        },
        {
          "name": "instrument",
          "writable": true,
          "relations": [
            "action"
          ]
        },
        {
          "name": "action",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "instrument"
              },
              {
                "kind": "account",
                "path": "action.id",
                "account": "corporateAction"
              }
            ]
          }
        },
        {
          "name": "vault",
          "docs": [
            "Paying vault for this action, owned by the action PDA (created at announce)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "action"
              }
            ]
          }
        },
        {
          "name": "issuerSettlement",
          "writable": true
        },
        {
          "name": "settlementMint",
          "relations": [
            "instrument"
          ]
        },
        {
          "name": "settlementTokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initializeInstrument",
      "docs": [
        "Create the instrument and its Token-2022 bond mint (hook + permanent delegate + metadata)."
      ],
      "discriminator": [
        40,
        72,
        203,
        208,
        64,
        129,
        147,
        181
      ],
      "accounts": [
        {
          "name": "issuer",
          "writable": true,
          "signer": true
        },
        {
          "name": "mint",
          "docs": [
            "delegate and metadata extensions."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "instrument",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  116,
                  114,
                  117,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "extraAccountMetaList",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  120,
                  116,
                  114,
                  97,
                  45,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  45,
                  109,
                  101,
                  116,
                  97,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "settlementMint"
        },
        {
          "name": "settlementTokenProgram"
        },
        {
          "name": "tokenProgram",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "instrumentParams"
            }
          }
        }
      ]
    },
    {
      "name": "issue",
      "docs": [
        "Mint bond units to a holder (primary placement)."
      ],
      "discriminator": [
        190,
        1,
        98,
        214,
        81,
        99,
        222,
        247
      ],
      "accounts": [
        {
          "name": "issuer",
          "writable": true,
          "signer": true,
          "relations": [
            "instrument"
          ]
        },
        {
          "name": "instrument",
          "writable": true
        },
        {
          "name": "mint",
          "writable": true,
          "relations": [
            "instrument"
          ]
        },
        {
          "name": "holder"
        },
        {
          "name": "holderToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "holder"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "allowEntry",
          "docs": [
            "Required when the allowlist is on."
          ],
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  108,
                  108,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "instrument"
              },
              {
                "kind": "account",
                "path": "holder"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "units",
          "type": "u64"
        }
      ]
    },
    {
      "name": "lockRecord",
      "discriminator": [
        235,
        186,
        186,
        61,
        61,
        130,
        86,
        157
      ],
      "accounts": [
        {
          "name": "cranker",
          "signer": true
        },
        {
          "name": "instrument",
          "relations": [
            "action"
          ]
        },
        {
          "name": "action",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "instrument"
              },
              {
                "kind": "account",
                "path": "action.id",
                "account": "corporateAction"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "instrument"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "pay",
      "discriminator": [
        119,
        18,
        216,
        65,
        192,
        117,
        122,
        220
      ],
      "accounts": [
        {
          "name": "payingAgent",
          "writable": true,
          "signer": true
        },
        {
          "name": "holder"
        },
        {
          "name": "instrument",
          "writable": true,
          "relations": [
            "action"
          ]
        },
        {
          "name": "action",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "instrument"
              },
              {
                "kind": "account",
                "path": "action.id",
                "account": "corporateAction"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "action"
              }
            ]
          }
        },
        {
          "name": "holderSettlement",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "holder"
              },
              {
                "kind": "account",
                "path": "settlementTokenProgram"
              },
              {
                "kind": "account",
                "path": "settlementMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "mint",
          "writable": true,
          "relations": [
            "instrument"
          ]
        },
        {
          "name": "holderBond",
          "writable": true,
          "optional": true
        },
        {
          "name": "receipt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  108,
                  97,
                  105,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "action"
              },
              {
                "kind": "account",
                "path": "holder"
              }
            ]
          }
        },
        {
          "name": "settlementMint",
          "relations": [
            "instrument"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "settlementTokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "units",
          "type": "u64"
        },
        {
          "name": "proof",
          "type": {
            "vec": {
              "array": [
                "u8",
                32
              ]
            }
          }
        }
      ]
    },
    {
      "name": "postSnapshot",
      "discriminator": [
        44,
        200,
        134,
        75,
        104,
        188,
        11,
        73
      ],
      "accounts": [
        {
          "name": "issuer",
          "signer": true,
          "relations": [
            "instrument"
          ]
        },
        {
          "name": "instrument",
          "writable": true,
          "relations": [
            "action"
          ]
        },
        {
          "name": "action",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "instrument"
              },
              {
                "kind": "account",
                "path": "action.id",
                "account": "corporateAction"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "instrument"
          ]
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "snapshotParams"
            }
          }
        }
      ]
    },
    {
      "name": "setAllowlist",
      "discriminator": [
        141,
        30,
        41,
        131,
        132,
        7,
        216,
        134
      ],
      "accounts": [
        {
          "name": "issuer",
          "signer": true,
          "relations": [
            "instrument"
          ]
        },
        {
          "name": "instrument",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "enabled",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setPayingAgent",
      "discriminator": [
        146,
        114,
        215,
        35,
        79,
        46,
        129,
        106
      ],
      "accounts": [
        {
          "name": "issuer",
          "signer": true,
          "relations": [
            "instrument"
          ]
        },
        {
          "name": "instrument",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "payingAgent",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "settle",
      "discriminator": [
        175,
        42,
        185,
        87,
        144,
        131,
        102,
        212
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "instrument",
          "writable": true,
          "relations": [
            "action"
          ]
        },
        {
          "name": "action",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "instrument"
              },
              {
                "kind": "account",
                "path": "action.id",
                "account": "corporateAction"
              }
            ]
          }
        },
        {
          "name": "issuer",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "action"
              }
            ]
          }
        },
        {
          "name": "issuerSettlement",
          "writable": true,
          "optional": true
        },
        {
          "name": "settlementMint",
          "optional": true
        },
        {
          "name": "settlementTokenProgram",
          "optional": true
        }
      ],
      "args": []
    },
    {
      "name": "transferHook",
      "docs": [
        "SPL transfer-hook `Execute`, invoked by Token-2022 on every bond transfer."
      ],
      "discriminator": [
        105,
        37,
        101,
        197,
        75,
        251,
        102,
        26
      ],
      "accounts": [
        {
          "name": "sourceToken"
        },
        {
          "name": "mint"
        },
        {
          "name": "destinationToken"
        },
        {
          "name": "owner"
        },
        {
          "name": "extraAccountMetaList",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  120,
                  116,
                  114,
                  97,
                  45,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  45,
                  109,
                  101,
                  116,
                  97,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "instrument",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  115,
                  116,
                  114,
                  117,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "allowEntry",
          "docs": [
            "allowlist is on."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  108,
                  108,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "instrument"
              },
              {
                "kind": "account",
                "path": "destinationToken.owner"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "allowEntry",
      "discriminator": [
        3,
        29,
        6,
        254,
        2,
        209,
        219,
        245
      ]
    },
    {
      "name": "claimReceipt",
      "discriminator": [
        223,
        233,
        11,
        229,
        124,
        165,
        207,
        28
      ]
    },
    {
      "name": "corporateAction",
      "discriminator": [
        144,
        225,
        182,
        199,
        4,
        234,
        12,
        32
      ]
    },
    {
      "name": "instrument",
      "discriminator": [
        59,
        14,
        92,
        146,
        115,
        34,
        155,
        145
      ]
    },
    {
      "name": "voteRecord",
      "discriminator": [
        112,
        9,
        123,
        165,
        234,
        9,
        157,
        167
      ]
    }
  ],
  "events": [
    {
      "name": "actionAnnounced",
      "discriminator": [
        183,
        193,
        90,
        98,
        193,
        99,
        3,
        0
      ]
    },
    {
      "name": "actionCancelled",
      "discriminator": [
        121,
        213,
        205,
        29,
        226,
        181,
        230,
        13
      ]
    },
    {
      "name": "actionFunded",
      "discriminator": [
        86,
        14,
        72,
        100,
        66,
        157,
        25,
        135
      ]
    },
    {
      "name": "actionSettled",
      "discriminator": [
        104,
        222,
        224,
        188,
        243,
        117,
        196,
        135
      ]
    },
    {
      "name": "allowlistToggled",
      "discriminator": [
        203,
        193,
        16,
        35,
        177,
        19,
        175,
        214
      ]
    },
    {
      "name": "allowlistUpdated",
      "discriminator": [
        88,
        239,
        93,
        65,
        74,
        140,
        83,
        213
      ]
    },
    {
      "name": "entitlementPaid",
      "discriminator": [
        12,
        205,
        37,
        164,
        180,
        249,
        36,
        79
      ]
    },
    {
      "name": "instrumentCreated",
      "discriminator": [
        124,
        97,
        228,
        227,
        195,
        63,
        218,
        121
      ]
    },
    {
      "name": "instrumentMatured",
      "discriminator": [
        212,
        37,
        90,
        83,
        13,
        244,
        156,
        25
      ]
    },
    {
      "name": "instrumentRedeemed",
      "discriminator": [
        189,
        70,
        178,
        44,
        13,
        156,
        194,
        181
      ]
    },
    {
      "name": "payingAgentUpdated",
      "discriminator": [
        141,
        79,
        195,
        106,
        2,
        249,
        95,
        117
      ]
    },
    {
      "name": "recordLocked",
      "discriminator": [
        192,
        85,
        71,
        125,
        204,
        5,
        187,
        255
      ]
    },
    {
      "name": "snapshotPosted",
      "discriminator": [
        224,
        99,
        100,
        104,
        153,
        13,
        20,
        15
      ]
    },
    {
      "name": "unitsIssued",
      "discriminator": [
        78,
        151,
        16,
        72,
        131,
        100,
        67,
        205
      ]
    },
    {
      "name": "unitsRedeemed",
      "discriminator": [
        174,
        175,
        35,
        22,
        193,
        92,
        93,
        78
      ]
    },
    {
      "name": "voteCast",
      "discriminator": [
        39,
        53,
        195,
        104,
        188,
        17,
        225,
        213
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "notIssuer",
      "msg": "Only the instrument issuer may do this"
    },
    {
      "code": 6001,
      "name": "notPayingAgent",
      "msg": "Only the paying agent or the issuer may push payments"
    },
    {
      "code": 6002,
      "name": "invalidFrequency",
      "msg": "Coupon frequency must be 1, 2, 4 or 12 payments per year"
    },
    {
      "code": 6003,
      "name": "invalidFaceValue",
      "msg": "Face value must be greater than zero"
    },
    {
      "code": 6004,
      "name": "invalidRate",
      "msg": "Coupon rate is out of range"
    },
    {
      "code": 6005,
      "name": "invalidMaturity",
      "msg": "Maturity must be after issue"
    },
    {
      "code": 6006,
      "name": "invalidMetadata",
      "msg": "Name, symbol or URI is too long or empty"
    },
    {
      "code": 6007,
      "name": "invalidSettlementMint",
      "msg": "Settlement mint is the bond mint or has fee / hook / non-transferable extensions"
    },
    {
      "code": 6008,
      "name": "instrumentNotActive",
      "msg": "Instrument is not active"
    },
    {
      "code": 6009,
      "name": "pendingActionExists",
      "msg": "Another corporate action is still before its payment phase"
    },
    {
      "code": 6010,
      "name": "redemptionInProgress",
      "msg": "A redemption is in progress; no other action may run"
    },
    {
      "code": 6011,
      "name": "actionsStillOpen",
      "msg": "A redemption needs every other action to be settled first"
    },
    {
      "code": 6012,
      "name": "registerLocked",
      "msg": "The register is locked for a corporate action; issuance is paused"
    },
    {
      "code": 6013,
      "name": "zeroUnits",
      "msg": "Units must be greater than zero"
    },
    {
      "code": 6014,
      "name": "invalidSchedule",
      "msg": "Schedule must satisfy now <= record < payment <= claim deadline"
    },
    {
      "code": 6015,
      "name": "invalidTitle",
      "msg": "Title is too long or empty"
    },
    {
      "code": 6016,
      "name": "invalidRedeemShare",
      "msg": "Redemption share must be between 1 and 9999 bps"
    },
    {
      "code": 6017,
      "name": "invalidPrice",
      "msg": "Redemption price must be between 1 and 20000 bps of face"
    },
    {
      "code": 6018,
      "name": "invalidVoteOptions",
      "msg": "Votes need 2 to 4 options of 1 to 32 bytes"
    },
    {
      "code": 6019,
      "name": "unexpectedParameter",
      "msg": "Parameter does not apply to this action kind"
    },
    {
      "code": 6020,
      "name": "lockStillRunning",
      "msg": "Current ex-date lock ends before this record date; announce after it ends"
    },
    {
      "code": 6021,
      "name": "invalidActionStatus",
      "msg": "Action is not in the status this instruction requires"
    },
    {
      "code": 6022,
      "name": "wrongActionKind",
      "msg": "Action kind does not support this instruction"
    },
    {
      "code": 6023,
      "name": "recordDateNotReached",
      "msg": "Record date has not been reached"
    },
    {
      "code": 6024,
      "name": "recordWindowMissed",
      "msg": "Record window passed without locking the register; cancel and re-announce"
    },
    {
      "code": 6025,
      "name": "supplyMismatch",
      "msg": "Snapshot total units do not equal the bond supply"
    },
    {
      "code": 6026,
      "name": "invalidHolderCount",
      "msg": "Holder count must be between 1 and total units"
    },
    {
      "code": 6027,
      "name": "invalidSnapshotRoot",
      "msg": "Merkle root must not be zero"
    },
    {
      "code": 6028,
      "name": "redeemTotalOutOfBounds",
      "msg": "Posted redeemed-unit total is inconsistent with per-holder rounding"
    },
    {
      "code": 6029,
      "name": "zeroEntitlement",
      "msg": "Total entitlement is zero; nothing to pay"
    },
    {
      "code": 6030,
      "name": "overFunding",
      "msg": "Funding would exceed the total entitlement"
    },
    {
      "code": 6031,
      "name": "zeroFunding",
      "msg": "Funding amount must be greater than zero"
    },
    {
      "code": 6032,
      "name": "actionNotFunded",
      "msg": "Action is not fully funded"
    },
    {
      "code": 6033,
      "name": "paymentNotDue",
      "msg": "Payment date has not been reached"
    },
    {
      "code": 6034,
      "name": "alreadyClaimed",
      "msg": "Entitlement already paid for this holder"
    },
    {
      "code": 6035,
      "name": "invalidProof",
      "msg": "Merkle proof does not match the snapshot root"
    },
    {
      "code": 6036,
      "name": "proofTooLong",
      "msg": "Merkle proof is too long"
    },
    {
      "code": 6037,
      "name": "snapshotTotalsExceeded",
      "msg": "Claim would exceed the snapshot totals"
    },
    {
      "code": 6038,
      "name": "insufficientVaultFunds",
      "msg": "Paying vault does not hold enough funds"
    },
    {
      "code": 6039,
      "name": "missingHolderBondAccount",
      "msg": "Redemption requires the holder's bond token account"
    },
    {
      "code": 6040,
      "name": "invalidHolderBondAccount",
      "msg": "Bond token account does not belong to the holder or the instrument"
    },
    {
      "code": 6041,
      "name": "insufficientUnitsToRedeem",
      "msg": "Holder no longer holds the units being redeemed"
    },
    {
      "code": 6042,
      "name": "alreadyVoted",
      "msg": "Vote already cast for this holder"
    },
    {
      "code": 6043,
      "name": "invalidVoteChoice",
      "msg": "Vote choice is out of range"
    },
    {
      "code": 6044,
      "name": "votingClosed",
      "msg": "Voting is closed"
    },
    {
      "code": 6045,
      "name": "votingNotClosed",
      "msg": "Voting is still open"
    },
    {
      "code": 6046,
      "name": "votesAlreadyCast",
      "msg": "Votes were already cast; the vote cannot be cancelled"
    },
    {
      "code": 6047,
      "name": "claimWindowOpen",
      "msg": "Claim window is still open and entitlements are outstanding"
    },
    {
      "code": 6048,
      "name": "missingSettlementAccounts",
      "msg": "Paying vault and issuer settlement account are required"
    },
    {
      "code": 6049,
      "name": "invalidSettlementAccount",
      "msg": "Settlement token account is not the expected one"
    },
    {
      "code": 6050,
      "name": "transferLocked",
      "msg": "Bond transfers are locked between record date and payment"
    },
    {
      "code": 6051,
      "name": "destinationNotAllowlisted",
      "msg": "Destination wallet is not on the instrument allowlist"
    },
    {
      "code": 6052,
      "name": "notTransferring",
      "msg": "Hook may only run inside a Token-2022 transfer"
    },
    {
      "code": 6053,
      "name": "allowlistEntryRequired",
      "msg": "Allowlist entry required for this holder"
    },
    {
      "code": 6054,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    }
  ],
  "types": [
    {
      "name": "actionAnnounced",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "instrument",
            "type": "pubkey"
          },
          {
            "name": "action",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "kind",
            "type": {
              "defined": {
                "name": "actionKind"
              }
            }
          },
          {
            "name": "recordTs",
            "type": "i64"
          },
          {
            "name": "paymentTs",
            "type": "i64"
          },
          {
            "name": "claimDeadline",
            "type": "i64"
          },
          {
            "name": "amountPerUnit",
            "type": "u64"
          },
          {
            "name": "lockFrom",
            "type": "i64"
          },
          {
            "name": "lockUntil",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "actionCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "instrument",
            "type": "pubkey"
          },
          {
            "name": "action",
            "type": "pubkey"
          },
          {
            "name": "previousStatus",
            "type": {
              "defined": {
                "name": "actionStatus"
              }
            }
          },
          {
            "name": "refundedAmount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "actionFunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "instrument",
            "type": "pubkey"
          },
          {
            "name": "action",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "fundedAmount",
            "type": "u64"
          },
          {
            "name": "totalEntitlement",
            "type": "u64"
          },
          {
            "name": "fullyFunded",
            "docs": [
              "True once funded_amount == total_entitlement (status Funded)."
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "actionKind",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "coupon"
          },
          {
            "name": "partialRedemption"
          },
          {
            "name": "finalRedemption"
          },
          {
            "name": "vote"
          }
        ]
      }
    },
    {
      "name": "actionSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "instrument",
            "type": "pubkey"
          },
          {
            "name": "action",
            "type": "pubkey"
          },
          {
            "name": "kind",
            "type": {
              "defined": {
                "name": "actionKind"
              }
            }
          },
          {
            "name": "paidAmount",
            "type": "u64"
          },
          {
            "name": "paidCount",
            "type": "u32"
          },
          {
            "name": "sweptAmount",
            "type": "u64"
          },
          {
            "name": "winningOption",
            "type": {
              "option": "u8"
            }
          }
        ]
      }
    },
    {
      "name": "actionStatus",
      "docs": [
        "Strict lifecycle. Votes skip `Funded`: SnapshotPosted opens voting, the first ballot moves the",
        "action to `Settling`, and `settle` after the close closes the tally."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "announced"
          },
          {
            "name": "recordLocked"
          },
          {
            "name": "snapshotPosted"
          },
          {
            "name": "funded"
          },
          {
            "name": "settling"
          },
          {
            "name": "settled"
          },
          {
            "name": "cancelled"
          }
        ]
      }
    },
    {
      "name": "allowEntry",
      "docs": [
        "Wallet allowed to receive the bond when the allowlist is on. PDA [b\"allow\", instrument, wallet]."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "instrument",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "addedTs",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "allowlistToggled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "instrument",
            "type": "pubkey"
          },
          {
            "name": "enabled",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "allowlistUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "instrument",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "allowed",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "announceParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "kind",
            "type": {
              "defined": {
                "name": "actionKind"
              }
            }
          },
          {
            "name": "title",
            "type": "string"
          },
          {
            "name": "termsHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "recordTs",
            "type": "i64"
          },
          {
            "name": "paymentTs",
            "type": "i64"
          },
          {
            "name": "claimDeadline",
            "type": "i64"
          },
          {
            "name": "rateBps",
            "docs": [
              "Coupon: annual rate (0 = instrument rate). FinalRedemption: final coupon rate (0 = none)."
            ],
            "type": "u16"
          },
          {
            "name": "redeemBps",
            "docs": [
              "PartialRedemption only."
            ],
            "type": "u16"
          },
          {
            "name": "priceBps",
            "docs": [
              "Redemptions only (10_000 = par)."
            ],
            "type": "u16"
          },
          {
            "name": "options",
            "docs": [
              "Vote only."
            ],
            "type": {
              "vec": "string"
            }
          }
        ]
      }
    },
    {
      "name": "claimReceipt",
      "docs": [
        "Proof that a holder was paid for an action. PDA [b\"claim\", action, holder]."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "action",
            "type": "pubkey"
          },
          {
            "name": "holder",
            "type": "pubkey"
          },
          {
            "name": "units",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "burnedUnits",
            "type": "u64"
          },
          {
            "name": "mode",
            "type": {
              "defined": {
                "name": "paymentMode"
              }
            }
          },
          {
            "name": "paidBy",
            "type": "pubkey"
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "ts",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "corporateAction",
      "docs": [
        "One corporate action. PDA [b\"action\", instrument, id as u64 LE]."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "instrument",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "kind",
            "type": {
              "defined": {
                "name": "actionKind"
              }
            }
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "actionStatus"
              }
            }
          },
          {
            "name": "title",
            "type": "string"
          },
          {
            "name": "termsHash",
            "docs": [
              "sha256 of the off-chain announcement document (prospectus notice, vote question, ...)."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "recordTs",
            "type": "i64"
          },
          {
            "name": "paymentTs",
            "docs": [
              "Payment date, or vote close for votes."
            ],
            "type": "i64"
          },
          {
            "name": "claimDeadline",
            "docs": [
              "After this the issuer may sweep unclaimed funds back."
            ],
            "type": "i64"
          },
          {
            "name": "rateBps",
            "docs": [
              "Coupon: annual rate for this period. FinalRedemption: rate of the final coupon (0 = none)."
            ],
            "type": "u16"
          },
          {
            "name": "redeemBps",
            "docs": [
              "PartialRedemption: share of every holding redeemed."
            ],
            "type": "u16"
          },
          {
            "name": "priceBps",
            "docs": [
              "Redemptions: price in bps of face (10_000 = par)."
            ],
            "type": "u16"
          },
          {
            "name": "period",
            "docs": [
              "Coupon period number (1-based); 0 for other kinds."
            ],
            "type": "u16"
          },
          {
            "name": "options",
            "type": {
              "vec": "string"
            }
          },
          {
            "name": "amountPerUnit",
            "docs": [
              "Settlement base units per unit: per held unit (Coupon, FinalRedemption) or per redeemed unit",
              "(PartialRedemption). Fixed at announcement."
            ],
            "type": "u64"
          },
          {
            "name": "recordSupply",
            "type": "u64"
          },
          {
            "name": "recordSlot",
            "type": "u64"
          },
          {
            "name": "recordLockedTs",
            "type": "i64"
          },
          {
            "name": "merkleRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "snapshotHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "totalUnits",
            "type": "u64"
          },
          {
            "name": "holderCount",
            "type": "u32"
          },
          {
            "name": "snapshotSlot",
            "type": "u64"
          },
          {
            "name": "totalRedeemUnits",
            "docs": [
              "Units that will be burned in total (redemptions)."
            ],
            "type": "u64"
          },
          {
            "name": "totalEntitlement",
            "docs": [
              "Settlement owed to all holders; computed on-chain."
            ],
            "type": "u64"
          },
          {
            "name": "fundedAmount",
            "type": "u64"
          },
          {
            "name": "paidAmount",
            "type": "u64"
          },
          {
            "name": "paidCount",
            "type": "u32"
          },
          {
            "name": "claimedUnits",
            "type": "u64"
          },
          {
            "name": "redeemedUnits",
            "type": "u64"
          },
          {
            "name": "sweptAmount",
            "type": "u64"
          },
          {
            "name": "tally",
            "type": {
              "array": [
                "u64",
                4
              ]
            }
          },
          {
            "name": "votesCast",
            "type": "u32"
          },
          {
            "name": "winningOption",
            "type": {
              "option": "u8"
            }
          },
          {
            "name": "prevLockFrom",
            "docs": [
              "Lock window before this action merged into it (restored on cancel)."
            ],
            "type": "i64"
          },
          {
            "name": "prevLockUntil",
            "type": "i64"
          },
          {
            "name": "announcedTs",
            "type": "i64"
          },
          {
            "name": "fundedTs",
            "type": "i64"
          },
          {
            "name": "settledTs",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "entitlementPaid",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "instrument",
            "type": "pubkey"
          },
          {
            "name": "action",
            "type": "pubkey"
          },
          {
            "name": "holder",
            "type": "pubkey"
          },
          {
            "name": "units",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "burnedUnits",
            "type": "u64"
          },
          {
            "name": "mode",
            "type": {
              "defined": {
                "name": "paymentMode"
              }
            }
          },
          {
            "name": "paidBy",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "instrument",
      "docs": [
        "One tokenized bond. PDA [b\"instrument\", mint]. It is the bond mint's mint authority, permanent",
        "delegate, transfer-hook authority and metadata update authority."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "issuer",
            "type": "pubkey"
          },
          {
            "name": "payingAgent",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "docs": [
              "Token-2022 bond mint, 0 decimals."
            ],
            "type": "pubkey"
          },
          {
            "name": "settlementMint",
            "type": "pubkey"
          },
          {
            "name": "settlementTokenProgram",
            "type": "pubkey"
          },
          {
            "name": "settlementDecimals",
            "type": "u8"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "symbol",
            "type": "string"
          },
          {
            "name": "isin",
            "docs": [
              "ISO 6166 identifier, ASCII, zero padded (may be all zero on devnet)."
            ],
            "type": {
              "array": [
                "u8",
                12
              ]
            }
          },
          {
            "name": "faceValue",
            "docs": [
              "Par value of one bond unit in settlement base units."
            ],
            "type": "u64"
          },
          {
            "name": "couponBps",
            "docs": [
              "Annual coupon rate in bps."
            ],
            "type": "u16"
          },
          {
            "name": "couponFrequency",
            "docs": [
              "Coupon payments per year (1, 2, 4, 12)."
            ],
            "type": "u8"
          },
          {
            "name": "issueTs",
            "type": "i64"
          },
          {
            "name": "maturityTs",
            "type": "i64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "instrumentStatus"
              }
            }
          },
          {
            "name": "allowlistEnabled",
            "type": "bool"
          },
          {
            "name": "lockFrom",
            "docs": [
              "Ex-date lock window enforced by the transfer hook: transfers fail while",
              "lock_from <= now < lock_until."
            ],
            "type": "i64"
          },
          {
            "name": "lockUntil",
            "type": "i64"
          },
          {
            "name": "issuedUnits",
            "docs": [
              "Units ever minted."
            ],
            "type": "u64"
          },
          {
            "name": "redeemedUnits",
            "docs": [
              "Units burned by redemptions."
            ],
            "type": "u64"
          },
          {
            "name": "actionCount",
            "docs": [
              "Next action id."
            ],
            "type": "u64"
          },
          {
            "name": "couponPeriods",
            "docs": [
              "Coupon periods announced so far (the next coupon is period coupon_periods + 1)."
            ],
            "type": "u16"
          },
          {
            "name": "pendingAction",
            "docs": [
              "Action that has not yet reached its payment phase (Funded, or SnapshotPosted for votes)."
            ],
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "openActions",
            "docs": [
              "Actions not yet Settled or Cancelled."
            ],
            "type": "u32"
          },
          {
            "name": "openRedemption",
            "docs": [
              "A redemption is open: it runs alone."
            ],
            "type": "bool"
          },
          {
            "name": "createdTs",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "instrumentCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "instrument",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "issuer",
            "type": "pubkey"
          },
          {
            "name": "settlementMint",
            "type": "pubkey"
          },
          {
            "name": "faceValue",
            "type": "u64"
          },
          {
            "name": "couponBps",
            "type": "u16"
          },
          {
            "name": "couponFrequency",
            "type": "u8"
          },
          {
            "name": "maturityTs",
            "type": "i64"
          },
          {
            "name": "allowlistEnabled",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "instrumentMatured",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "instrument",
            "type": "pubkey"
          },
          {
            "name": "action",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "instrumentParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "symbol",
            "type": "string"
          },
          {
            "name": "uri",
            "type": "string"
          },
          {
            "name": "isin",
            "type": {
              "array": [
                "u8",
                12
              ]
            }
          },
          {
            "name": "faceValue",
            "docs": [
              "Par value per unit in settlement base units."
            ],
            "type": "u64"
          },
          {
            "name": "couponBps",
            "type": "u16"
          },
          {
            "name": "couponFrequency",
            "type": "u8"
          },
          {
            "name": "issueTs",
            "type": "i64"
          },
          {
            "name": "maturityTs",
            "type": "i64"
          },
          {
            "name": "allowlistEnabled",
            "type": "bool"
          },
          {
            "name": "payingAgent",
            "docs": [
              "Defaults to the issuer when None."
            ],
            "type": {
              "option": "pubkey"
            }
          }
        ]
      }
    },
    {
      "name": "instrumentRedeemed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "instrument",
            "type": "pubkey"
          },
          {
            "name": "action",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "instrumentStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "matured"
          },
          {
            "name": "redeemed"
          }
        ]
      }
    },
    {
      "name": "payingAgentUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "instrument",
            "type": "pubkey"
          },
          {
            "name": "payingAgent",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "paymentMode",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "claim"
          },
          {
            "name": "push"
          }
        ]
      }
    },
    {
      "name": "recordLocked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "instrument",
            "type": "pubkey"
          },
          {
            "name": "action",
            "type": "pubkey"
          },
          {
            "name": "recordSupply",
            "type": "u64"
          },
          {
            "name": "recordSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "snapshotParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "merkleRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "snapshotHash",
            "docs": [
              "sha256 of the canonical snapshot JSON published off-chain."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "totalUnits",
            "type": "u64"
          },
          {
            "name": "holderCount",
            "type": "u32"
          },
          {
            "name": "totalRedeemUnits",
            "docs": [
              "PartialRedemption: sum of per-holder floor(units * redeem_bps / 10_000). Ignored otherwise."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "snapshotPosted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "instrument",
            "type": "pubkey"
          },
          {
            "name": "action",
            "type": "pubkey"
          },
          {
            "name": "merkleRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "snapshotHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "totalUnits",
            "type": "u64"
          },
          {
            "name": "holderCount",
            "type": "u32"
          },
          {
            "name": "totalRedeemUnits",
            "type": "u64"
          },
          {
            "name": "totalEntitlement",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "unitsIssued",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "instrument",
            "type": "pubkey"
          },
          {
            "name": "holder",
            "type": "pubkey"
          },
          {
            "name": "units",
            "type": "u64"
          },
          {
            "name": "supply",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "unitsRedeemed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "instrument",
            "type": "pubkey"
          },
          {
            "name": "action",
            "type": "pubkey"
          },
          {
            "name": "holder",
            "type": "pubkey"
          },
          {
            "name": "units",
            "type": "u64"
          },
          {
            "name": "supplyAfter",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "voteCast",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "instrument",
            "type": "pubkey"
          },
          {
            "name": "action",
            "type": "pubkey"
          },
          {
            "name": "holder",
            "type": "pubkey"
          },
          {
            "name": "choice",
            "type": "u8"
          },
          {
            "name": "weight",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "voteRecord",
      "docs": [
        "A holder's ballot. PDA [b\"vote\", action, holder]."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "action",
            "type": "pubkey"
          },
          {
            "name": "holder",
            "type": "pubkey"
          },
          {
            "name": "choice",
            "type": "u8"
          },
          {
            "name": "weight",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "ts",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "actionSeed",
      "type": "bytes",
      "value": "[97, 99, 116, 105, 111, 110]"
    },
    {
      "name": "allowSeed",
      "type": "bytes",
      "value": "[97, 108, 108, 111, 119]"
    },
    {
      "name": "claimSeed",
      "type": "bytes",
      "value": "[99, 108, 97, 105, 109]"
    },
    {
      "name": "extraAccountMetasSeed",
      "docs": [
        "Seed fixed by the SPL transfer-hook interface for the validation account."
      ],
      "type": "bytes",
      "value": "[101, 120, 116, 114, 97, 45, 97, 99, 99, 111, 117, 110, 116, 45, 109, 101, 116, 97, 115]"
    },
    {
      "name": "instrumentSeed",
      "type": "bytes",
      "value": "[105, 110, 115, 116, 114, 117, 109, 101, 110, 116]"
    },
    {
      "name": "maxProofLen",
      "docs": [
        "Longest accepted Merkle proof (2^24 ≈ 16.7M holders)."
      ],
      "type": "u32",
      "value": "24"
    },
    {
      "name": "vaultSeed",
      "type": "bytes",
      "value": "[118, 97, 117, 108, 116]"
    },
    {
      "name": "voteSeed",
      "type": "bytes",
      "value": "[118, 111, 116, 101]"
    }
  ]
};
