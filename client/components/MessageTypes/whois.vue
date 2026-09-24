<template>
	<span class="content">
		<p>
			<bdi><Username :user="{nick: message.whois.nick}" /></bdi>
			<span v-if="message.whois.whowas"> {{ t("whois.offline") }}</span>
		</p>

		<!-- Each dt/dd pair is wrapped in a div (valid in a dl) so the label
		     can be positioned into the empty gutter column, right-aligned
		     against the row separator like a nick (style.css `.whois`). -->
		<dl class="whois">
			<div v-if="message.whois.account">
				<dt>{{ t("whois.loggedAs") }}</dt>
				<dd>{{ message.whois.account }}</dd>
			</div>

			<div>
				<dt>{{ t("whois.hostmask") }}</dt>
				<dd class="hostmask">
					<ParsedMessage
						:network="network"
						:text="message.whois.ident + '@' + message.whois.hostname"
					/>
				</dd>
			</div>

			<div v-if="message.whois.actual_hostname">
				<dt>{{ t("whois.actualHost") }}</dt>
				<dd class="hostmask">
					<a
						:href="'https://ipinfo.io/' + message.whois.actual_ip"
						target="_blank"
						rel="noopener"
						>{{ message.whois.actual_ip }}</a
					>
					<i v-if="message.whois.actual_hostname != message.whois.actual_ip">
						({{ message.whois.actual_hostname }})</i
					>
				</dd>
			</div>

			<div v-if="message.whois.actual_username">
				<dt>{{ t("whois.actualUsername") }}</dt>
				<dd>{{ message.whois.actual_username }}</dd>
			</div>

			<div v-if="message.whois.real_name">
				<dt>{{ t("whois.realName") }}</dt>
				<dd><ParsedMessage :network="network" :text="message.whois.real_name" /></dd>
			</div>

			<div v-if="message.whois.registered_nick">
				<dt>{{ t("whois.registeredNick") }}</dt>
				<dd>{{ message.whois.registered_nick }}</dd>
			</div>

			<div v-if="message.whois.channels">
				<dt>{{ t("whois.channels") }}</dt>
				<dd><ParsedMessage :network="network" :text="message.whois.channels" /></dd>
			</div>

			<div v-if="message.whois.modes">
				<dt>{{ t("whois.modes") }}</dt>
				<dd>{{ message.whois.modes }}</dd>
			</div>

			<template v-if="message.whois.special">
				<div v-for="special in message.whois.special" :key="special">
					<dt>{{ t("whois.special") }}</dt>
					<dd>{{ special }}</dd>
				</div>
			</template>

			<div v-if="message.whois.operator">
				<dt>{{ t("whois.operator") }}</dt>
				<dd>{{ message.whois.operator }}</dd>
			</div>

			<div v-if="message.whois.helpop">
				<dt>{{ t("whois.helpop") }}</dt>
				<dd>{{ t("whois.yes") }}</dd>
			</div>

			<div v-if="message.whois.bot">
				<dt>{{ t("whois.bot") }}</dt>
				<dd>{{ t("whois.yes") }}</dd>
			</div>

			<div v-if="message.whois.away">
				<dt>{{ t("whois.awayLabel") }}</dt>
				<dd><ParsedMessage :network="network" :text="message.whois.away" /></dd>
			</div>

			<div v-if="message.whois.secure">
				<dt>{{ t("whois.secure") }}</dt>
				<dd>{{ t("whois.yes") }}</dd>
			</div>

			<template v-if="message.whois.certfps">
				<div v-for="certfp in message.whois.certfps" :key="certfp">
					<dt>{{ t("whois.cert") }}</dt>
					<dd>{{ certfp }}</dd>
				</div>
			</template>

			<div v-if="message.whois.server">
				<dt>{{ t("whois.connectedTo") }}</dt>
				<dd>
					{{ message.whois.server }} <i>({{ message.whois.server_info }})</i>
				</dd>
			</div>

			<div v-if="message.whois.logonTime">
				<dt>{{ t("whois.connectedAt") }}</dt>
				<dd>{{ fullTime(message.whois.logonTime) }}</dd>
			</div>

			<div v-if="message.whois.idle">
				<dt>{{ t("whois.idleSince") }}</dt>
				<dd>{{ fullTime(message.whois.idleTime) }}</dd>
			</div>
		</dl>
	</span>
</template>

<script lang="ts">
import {defineComponent, PropType} from "vue";
import {formatDateTime} from "../../js/i18n/dates";
import {ClientNetwork, ClientMessage} from "../../js/types";
import ParsedMessage from "../ParsedMessage.vue";
import Username from "../Username.vue";
import {useI18n} from "../../js/i18n";

export default defineComponent({
	name: "MessageTypeWhois",
	components: {
		ParsedMessage,
		Username,
	},
	props: {
		network: {
			type: Object as PropType<ClientNetwork>,
			required: true,
		},
		message: {
			type: Object as PropType<ClientMessage>,
			required: true,
		},
	},
	setup() {
		const {t} = useI18n();

		return {
			t,
			fullTime: (date: number | Date) => formatDateTime(date),
		};
	},
});
</script>
