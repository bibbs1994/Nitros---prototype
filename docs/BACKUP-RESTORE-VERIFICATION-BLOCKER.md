# Backup restore verification blocker

The original repair-order restoration case is **not verified**. Earlier isolated
post-restore audit evidence reported `integrity: PASS`, but `matchesExpected` was
`null`; a later read-only check of the accessible staging profile reported no
active restored dataset. The original encrypted backup used for the reported
missing-field case and its matching persisted profile were not available for an
identifier-level comparison. Counts and schema checks cannot establish whether
customer details, mileage, inspection data, images, signatures, or RO history
match that original package.

The local encrypted-backup worktree contains an uncommitted compatibility adapter
for legacy repair-order draft hydration and synthetic tests. It was deliberately
not copied into this Support Center worktree. It does not prove the actual record
was complete in the original backup or persisted after the owner's activation.

## Minimum evidence needed

Make the original encrypted backup file used in that restore and the matching
isolated browser profile available for a read-only comparison. If the profile is
gone, provide the original backup and the expected canonical dataset hash from
the verification record. Do not send a recovery key, plaintext customer data, or
screenshots containing customer personal information in chat. The owner can enter
the key privately in the isolated recovery UI if decryption is needed.

No backup, restore, customer record, key, or production data was changed while
preparing the Support Center branch. Keep backup restoration as an unresolved
release blocker until expected-data comparison and post-reload readback pass.
