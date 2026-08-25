<template>
	<NetworkForm
		v-if="networkData"
		:handle-submit="handleSubmit"
		:defaults="networkData"
		:disabled="disabled"
	/>
</template>

<script lang="ts">
import {defineComponent, onMounted, reactive, ref, watch} from "vue";
import {useRoute} from "vue-router";
import {navigate, switchToChannel} from "../../js/router";
import socket from "../../js/socket";
import {useStore} from "../../js/store";
import type {SavedNetwork} from "../../js/irc/saved-networks";
import NetworkForm, {NetworkFormDefaults} from "../NetworkForm.vue";

/**
 * Edit a network: `network:get` answers (synchronously, via the bus) with
 * the saved entry merged with the live client's state; the form edits a
 * local copy and `network:edit` writes it back to localStorage, renaming /
 * re-nicking the live network where that applies.
 */
export default defineComponent({
	name: "NetworkEdit",
	components: {
		NetworkForm,
	},
	setup() {
		const route = useRoute();
		const store = useStore();

		const disabled = ref(false);
		const networkData = ref<NetworkFormDefaults | null>(null);

		const setNetworkData = () => {
			const uuid = String(route.params.uuid || "");
			let received: NetworkFormDefaults | null = null;

			const onInfo = (data: {uuid: string}) => {
				if (data.uuid === uuid) {
					received = reactive({...(data as NetworkFormDefaults)});
				}
			};

			socket.on("network:info", onInfo);
			socket.emit("network:get", uuid);
			socket.off("network:info", onInfo);

			if (!received) {
				// Not saved and not live: nothing to edit.
				const network = store.getters.findNetwork(uuid);
				received = network
					? reactive({
							uuid,
							name: network.name,
							host: "",
							port: 8443,
							tls: network.status.secure,
							nick: network.nick,
							join: "",
							sasl: "",
							saslAccount: "",
							saslPassword: "",
							connected: network.status.connected,
					  })
					: null;
			}

			networkData.value = received;
		};

		const handleSubmit = (data: SavedNetwork) => {
			disabled.value = true;
			socket.emit("network:edit", data);

			const network = store.getters.findNetwork(data.uuid);

			if (network) {
				switchToChannel(network.channels[0]);
			} else {
				void navigate("Connect");
			}

			disabled.value = false;
		};

		watch(
			() => route.params.uuid,
			() => {
				setNetworkData();
			}
		);

		onMounted(() => {
			setNetworkData();
		});

		return {
			disabled,
			networkData,
			handleSubmit,
		};
	},
});
</script>
