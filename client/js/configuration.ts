// Static, client-built configuration.
//
// TheLounge received this object from its Node server on every connection
// (`configuration` socket event). Seance has no such server, so the values
// are baked in at build time. Anything that is genuinely per-deployment
// (branding, default network) will move into a build-time config in a later
// phase; for now this is the single place to change them.

import pkg from "../../package.json";
import type {SharedConfiguration} from "../../shared/types/config";

const configuration: SharedConfiguration = {
	public: false,
	useHexIp: false,
	prefetch: false,
	fileUpload: false,
	ldapEnabled: false,
	isUpdateAvailable: false,
	applicationServerKey: "",
	version: pkg.version,
	gitCommit: null,
	themes: [
		{name: "default", displayName: "Default", themeColor: null},
		{name: "morning", displayName: "Morning", themeColor: null},
	],
	defaultTheme: "default",
	lockNetwork: false,
	defaults: {
		name: "",
		host: "",
		port: 6697,
		password: "",
		tls: true,
		rejectUnauthorized: true,
		nick: "",
		username: "",
		realname: "",
		join: "",
		leaveMessage: "",
		sasl: "",
		saslAccount: "",
		saslPassword: "",
	},
};

export default configuration;
