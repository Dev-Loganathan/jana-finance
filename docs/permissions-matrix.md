# Permissions Matrix

Generated from `packages/shared/src/permissions.ts` (regenerate with `pnpm docs:permissions`). Format is `module:action`. Roles are data and can be changed in the UI; this shows the **default templates** created by the seed. Super Admin is locked. Nobody can grant a permission they do not hold.

| Permission             | Super Admin | Admin | Staff | Manager |
| ---------------------- | :---------: | :---: | :---: | :-----: |
| `customer:view`        |      ✓      |   ✓   |   ✓   |    ✓    |
| `customer:create`      |      ✓      |   ✓   |   ✓   |    ✓    |
| `customer:edit`        |      ✓      |   ✓   |   ✓   |    ✓    |
| `customer:delete`      |      ✓      |   ✓   |       |         |
| `customer:export`      |      ✓      |   ✓   |       |    ✓    |
| `customer:import`      |      ✓      |   ✓   |       |         |
| `customer:blacklist`   |      ✓      |   ✓   |       |         |
| `kyc:view`             |      ✓      |   ✓   |   ✓   |    ✓    |
| `kyc:upload`           |      ✓      |   ✓   |   ✓   |         |
| `kyc:verify`           |      ✓      |   ✓   |       |    ✓    |
| `kyc:reject`           |      ✓      |   ✓   |       |    ✓    |
| `kyc:reveal_sensitive` |      ✓      |   ✓   |       |         |
| `chit:view`            |      ✓      |   ✓   |   ✓   |    ✓    |
| `chit:create`          |      ✓      |   ✓   |       |         |
| `chit:edit`            |      ✓      |   ✓   |       |         |
| `chit:member_assign`   |      ✓      |   ✓   |       |         |
| `chit:auction_conduct` |      ✓      |   ✓   |       |         |
| `chit:payout_approve`  |      ✓      |   ✓   |       |         |
| `loan:view`            |      ✓      |   ✓   |   ✓   |    ✓    |
| `loan:create`          |      ✓      |   ✓   |       |         |
| `loan:edit`            |      ✓      |   ✓   |       |         |
| `loan:approve`         |      ✓      |   ✓   |       |    ✓    |
| `loan:disburse`        |      ✓      |   ✓   |       |         |
| `loan:close`           |      ✓      |   ✓   |       |         |
| `loan:waive_penalty`   |      ✓      |   ✓   |       |         |
| `payment:view`         |      ✓      |   ✓   |   ✓   |    ✓    |
| `payment:create`       |      ✓      |   ✓   |   ✓   |         |
| `payment:reverse`      |      ✓      |   ✓   |       |         |
| `payment:backdate`     |      ✓      |       |       |         |
| `expense:view`         |      ✓      |   ✓   |       |         |
| `expense:manage`       |      ✓      |   ✓   |       |         |
| `report:view`          |      ✓      |   ✓   |       |    ✓    |
| `report:export`        |      ✓      |   ✓   |       |         |
| `notification:view`    |      ✓      |   ✓   |       |         |
| `notification:send`    |      ✓      |   ✓   |       |         |
| `user:view`            |      ✓      |   ✓   |       |         |
| `user:manage`          |      ✓      |       |       |         |
| `role:view`            |      ✓      |   ✓   |       |         |
| `role:manage`          |      ✓      |       |       |         |
| `audit:view`           |      ✓      |   ✓   |       |         |
| `settings:view`        |      ✓      |   ✓   |       |         |
| `settings:manage`      |      ✓      |       |       |         |
