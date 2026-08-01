# Studio Contracts

Provider-neutral JavaScript contracts and JSON schemas shared by a local studio and a separately operated hosted service.

The package contains no authentication, billing, cloud credentials, connector secrets, tenant authorization, production endpoints, or customer data. It is licensed under the Apache License, Version 2.0. Public releases are produced from a clean-history export after boundary and credential review.

```js
import {assertProject, normalizeGatewayRequest} from "@categori/studio-contracts";
```
