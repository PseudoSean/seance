<template>
	<ChannelWrapper v-bind="$props" :channel="channel">
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
		<div class="lobby-wrap">
			<span :title="channel.name" class="name">{{ channel.name }}</span>
			<span
				:aria-label="statusLabel"
				class="connection-status-tooltip tooltipped tooltipped-w"
			>
				<button
					:class="['connection-status-icon', statusClass]"
					:aria-label="statusLabel"
					@click.stop="onStatusClick"
				/>
			</span>
			<span v-if="channel.unread" :class="{highlight: channel.highlight}" class="badge">{{
				unreadCount
			}}</span>
		</div>
		<span
			aria-label="Edit this network…"
			class="edit-network-tooltip tooltipped tooltipped-w tooltipped-no-touch"
		>
			<button
				class="edit-network"
				aria-label="Edit this network…"
				@click.stop="editNetwork"
			/>
		</span>
		<span
			:aria-label="joinChannelLabel"
			class="add-channel-tooltip tooltipped tooltipped-w tooltipped-no-touch"
		>
			<button
				:class="['add-channel', {opened: isJoinChannelShown}]"
				:aria-controls="'join-channel-' + channel.id"
				:aria-label="joinChannelLabel"
				@click.stop="$emit('toggle-join-channel')"
			/>
		</span>
	</ChannelWrapper>
</template>

<script lang="ts">
import {computed, defineComponent, PropType} from "vue";
import {useRouter} from "vue-router";
import collapseNetwork from "../js/helpers/collapseNetwork";
import roundBadgeNumber from "../js/helpers/roundBadgeNumber";
import socket from "../js/socket";
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

		const channel = computed(() => {
			return props.network.channels[0];
		});

		const editNetwork = () => {
			void router.push(`/edit-network/${props.network.uuid}`);
		};

		const statusClass = computed(() =>
			props.network.status.connected
				? "is-connected"
				: props.network.status.connecting
				? "is-connecting"
				: "is-disconnected"
		);

		const statusLabel = computed(() =>
			props.network.status.connected
				? "Connected"
				: props.network.status.connecting
				? "Connecting… (click to cancel)"
				: "Disconnected (click to connect)"
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
			return props.isJoinChannelShown ? "Cancel" : "Join a channel…";
		});

		const unreadCount = computed(() => {
			return roundBadgeNumber(channel.value.unread);
		});

		const onCollapseClick = () => {
			collapseNetwork(props.network, !props.network.isCollapsed);
		};

		const getExpandLabel = (network: ClientNetwork) => {
			return network.isCollapsed ? "Expand" : "Collapse";
		};

		return {
			channel,
			editNetwork,
			statusClass,
			statusLabel,
			onStatusClick,
			joinChannelLabel,
			unreadCount,
			onCollapseClick,
			getExpandLabel,
		};
	},
});
</script>
