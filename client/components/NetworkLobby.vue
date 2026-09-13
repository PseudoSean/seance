<template>
	<ChannelWrapper v-bind="$props" :channel="channel">
		<!-- Two rows in one tab (see .lobby-wrap in style.css): the name gets
		     the whole first line; the tools sit left on the second, the nick
		     right. -->
		<div class="lobby-wrap">
			<div class="lobby-title">
				<button
					v-if="network.channels.length > 1"
					:aria-controls="'network-' + network.uuid"
					:aria-label="getExpandLabel(network)"
					:aria-expanded="!network.isCollapsed"
					class="collapse-network"
					@click.stop="onCollapseClick"
				>
					<span class="collapse-network-icon" />
				</button>
				<span v-else class="collapse-network" />
				<span :title="channel.name" class="name">{{ channel.name }}</span>
				<span v-if="channel.unread" :class="{highlight: channel.highlight}" class="badge">{{
					unreadCount
				}}</span>
			</div>
			<div class="lobby-status">
				<div class="lobby-tools">
					<span
						:aria-label="statusLabel"
						class="connection-status-tooltip tooltipped tooltipped-e"
					>
						<button
							:class="['connection-status-icon', statusClass]"
							:aria-label="statusLabel"
							@click.stop="onStatusClick"
						/>
					</span>
					<span
						:aria-label="notifyState.label"
						:title="notifyState.label"
						class="notify-tooltip"
					>
						<span :class="['notify-status-icon', notifyState.cls]" />
					</span>
					<span
						:aria-label="editLabel"
						class="edit-network-tooltip tooltipped tooltipped-e tooltipped-no-touch"
					>
						<button
							class="edit-network"
							:aria-label="editLabel"
							@click.stop="editNetwork"
						/>
					</span>
					<span
						:aria-label="joinChannelLabel"
						class="add-channel-tooltip tooltipped tooltipped-e tooltipped-no-touch"
					>
						<button
							:class="['add-channel', {opened: isJoinChannelShown}]"
							:aria-controls="'join-channel-' + channel.id"
							:aria-label="joinChannelLabel"
							@click.stop="$emit('toggle-join-channel')"
						/>
					</span>
				</div>
				<span v-if="network.nick" :title="nickLabel" class="lobby-nick"
					><span class="sr-only">{{ t("lobby.nickname") }}</span
					>{{ network.nick }}</span
				>
			</div>
		</div>
	</ChannelWrapper>
</template>

<script lang="ts">
import {computed, defineComponent, PropType} from "vue";
import {useRouter} from "vue-router";
import collapseNetwork from "../js/helpers/collapseNetwork";
import roundBadgeNumber from "../js/helpers/roundBadgeNumber";
import socket from "../js/socket";
import webpush from "../js/webpush";
import {useI18n} from "../js/i18n";
import ChannelWrapper from "./ChannelWrapper.vue";

import type {ClientChan, ClientNetwork} from "../js/types";

export default defineComponent({
	name: "Channel",
	components: {
		ChannelWrapper,
	},
	props: {
		network: {
			type: Object as PropType<ClientNetwork>,
			required: true,
		},
		isJoinChannelShown: Boolean,
		active: Boolean,
		isFiltering: Boolean,
	},
	emits: ["toggle-join-channel"],
	setup(props) {
		const router = useRouter();
		const {t} = useI18n();

		const channel = computed(() => {
			return props.network.channels[0];
		});

		const editNetwork = () => {
			void router.push(`/settings/networks/${props.network.uuid}`);
		};

		// Notification state for this network (bell icon): subscribed,
		// enabled-but-not-yet, or off. Reactive over webpush's maps + the
		// notify flag it mirrors from storage on saves.
		const notifyState = computed(() => {
			const info = webpush.networkPushInfo(props.network.uuid);
			const enabled = webpush.notifyOn(props.network.uuid);

			if (!enabled) {
				return {cls: "off", label: t("lobby.notificationsOff")};
			}

			if (info.enabled && info.subscribed) {
				return {cls: "on", label: t("lobby.notificationsSubscribed")};
			}

			return {cls: "enabled", label: t("lobby.notificationsOn")};
		});

		const statusClass = computed(() =>
			props.network.status.connected
				? "is-connected"
				: props.network.status.connecting
				? "is-connecting"
				: "is-disconnected"
		);

		const statusLabel = computed(() =>
			props.network.status.connected
				? t("lobby.connected")
				: props.network.status.connecting
				? t("lobby.connectingCancel")
				: t("lobby.disconnectedConnect")
		);

		const onStatusClick = () => {
			if (props.network.status.connected) {
				return; // no accidental disconnects; that lives on the edit page
			}

			socket.emit("input", {
				target: channel.value.id,
				text: props.network.status.connecting ? "/disconnect" : "/connect",
			});
		};

		const joinChannelLabel = computed(() => {
			return props.isJoinChannelShown ? t("lobby.cancel") : t("lobby.joinChannel");
		});

		// The nick under the network name is the one this connection uses;
		// before the first connect it is the configured one.
		const nickLabel = computed(() =>
			props.network.status.connected
				? t("lobby.nickOn", {network: props.network.name})
				: t("lobby.nickOffline", {network: props.network.name})
		);

		const unreadCount = computed(() => {
			return roundBadgeNumber(channel.value.unread);
		});

		const onCollapseClick = () => {
			collapseNetwork(props.network, !props.network.isCollapsed);
		};

		const getExpandLabel = (network: ClientNetwork) => {
			return network.isCollapsed ? t("lobby.expand") : t("lobby.collapse");
		};

		const editLabel = computed(() => t("lobby.edit"));

		return {
			notifyState,
			channel,
			editNetwork,
			editLabel,
			statusClass,
			statusLabel,
			onStatusClick,
			joinChannelLabel,
			nickLabel,
			unreadCount,
			onCollapseClick,
			getExpandLabel,
		};
	},
});
</script>
