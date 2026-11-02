# Acceptance-input review validation

The local receipt records the fixed current planning inputs, tested source digests and native focused results. It does not contain an actual approval, operator assignment, provider contract, credential or acceptance record.

Native Windows: 31 controls passed (28 unit, three functional use-case); deterministic report has 51 missing field groups and six pending gates. An activation-guard-removal negative control failed as intended, then exact source bytes were restored. A sandbox-only junction creation refusal was resolved by executing that owned control in the authorized native environment; it is not counted as a passing test.

The source guard rejects changed held inputs, including apparently free/zero cost, and outputs generic diagnostics. The file reader rejects actual junction aliases, traversal, case mismatches, invalid UTF-8 and oversized files. Functional tests compare all four input-file digests before/after two normal reports, the strict pending command and unsupported/effect-like arguments.

Publication requires exact-commit full local Linux validation, all eight existing independent CI jobs, review and checkout-tree verification. Actual completed publication results belong to the PR and are not predeclared here. No count is unique across focused/full runs. Historical evidence and existing gate policy remain unchanged; all HS/operator/S3/specialist/licensed/API/frontend holds persist. No hosted provisioning, purchases, actual notifications or original case/gate closure.
