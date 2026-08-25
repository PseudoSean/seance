<template>
	<div>
		<h2>Account</h2>
		<p>
			Not applicable in client-only mode. Seance connects your browser straight to the IRC
			network, so there is no account, password, or session list to manage here. Your settings
			are stored in this browser.
		</p>
	</div>
</template>

<script lang="ts">
import {defineComponent} from "vue";

export default defineComponent({
	name: "UserSettings",
});
</script>
