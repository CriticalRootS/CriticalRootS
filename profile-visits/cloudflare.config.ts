import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
	accountId: "5749e70ff84b420c256c5cf9b8fb8735",
	worker: {
		name: "github-profile-visits",
		compatibilityDate: "2026-11-23",
		entrypoint,
		workersDev: true,
		previewUrls: false,
		// Invocation logs/traces may contain request metadata. Do not persist them.
		observability: { enabled: false },
		env: {
			DB: bindings.d1({ id: "bbde1672-a5e5-4556-9db1-b1293e96f8fd", name: "github-profile-visits" }),
		},
	},
});
