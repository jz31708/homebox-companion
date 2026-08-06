# Deployment, Rollback, and Reacceptance

## Immediate recommendation

Until remediation is deployed:

- do not call current Bulk Sweep final;
- do not run the physical apartment pilot;
- either rollback to the prior stable Medicine V1.1 image or disable the broken/unauthenticated transcription route and clearly label Bulk Sweep preview-only.

Prior stable Medicine V1.1 digest recorded:
`sha256:763d0a25a659e04fc31790f41438f65a991eda6f2bcd32b9981e3ffa5ac9078d`

Current preview digest recorded:
`sha256:3a2bb3de06ad04f7ac9534faab98671568ee91af6ec088cb7982af734d31df59`

## Correct release sequence

1. Create clean remediation branch from current `origin/main`.
2. Port/fix implementation intentionally.
3. Open draft PR.
4. Complete independent code audit.
5. Run full automated suite.
6. Build image from reviewed commit.
7. Record exact commit/tag/digest.
8. Back up config, data, and ledger.
9. Deploy corrected image.
10. Verify API/auth and actual phone camera/transcription.
11. Run disposable Homebox acceptance with forced failures.
12. Verify operation ledger state and exact Homebox records.
13. Verify Classic and Medicine flows.
14. Only then unlock physical pilot.

## Disposable acceptance must include

- selected location without parent item;
- selected parent item;
- extended/custom fields;
- exact duplicate action;
- one item-create failure between two successes;
- one extended-update failure;
- one attachment failure;
- empty/missing attachment retry;
- response loss;
- server restart between steps;
- changed payload with reused key;
- no duplicate creation;
- correct photo mapping.

## Rollback trigger

Rollback for any:
- wrong location;
- duplicate on retry;
- wrong attachment;
- data loss on reload;
- unauthenticated provider access;
- Classic/Medicine regression;
- destructive migration.
