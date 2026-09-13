<template>
	<div class="settings-aliases" role="group" aria-label="Command aliases">
		<h2>Command aliases</h2>
		<p class="alias-intro">
			An alias is a slash command of your own. Typing
			<code>/{{ rows[0]?.name || "wave" }}</code> runs what you define here — one command per
			line, with the arguments filled in where the body says <code>$1</code>,
			<code>$2-</code> or <code>$*</code>.
		</p>

		<div v-if="rows.length" class="alias-table">
			<div class="alias-head" aria-hidden="true">
				<span class="alias-head-name">Alias</span>
				<span class="alias-head-body">Runs</span>
			</div>
			<div
				v-for="(row, index) in rows"
				:key="row.id"
				class="alias-row"
				:class="{'alias-row-invalid': rowError(index) !== null}"
			>
				<label class="alias-name-wrap">
					<span class="alias-slash" aria-hidden="true">/</span>
					<input
						v-model.trim="row.name"
						:aria-label="'Alias name ' + (index + 1)"
						class="input alias-name"
						type="text"
						placeholder="name"
						:maxlength="maxNameLength"
						spellcheck="false"
						autocapitalize="off"
						autocomplete="off"
					/>
				</label>
				<textarea
					v-model="row.body"
					:aria-label="'Commands for alias ' + (row.name || index + 1)"
					class="input alias-body"
					:rows="bodyRows(row)"
					placeholder="/me waves at $1"
					spellcheck="false"
					autocapitalize="off"
					autocomplete="off"
				/>
				<button
					class="alias-remove"
					type="button"
					:aria-label="'Remove alias ' + (row.name || index + 1)"
					@click="remove(index)"
				/>
				<div v-if="rowError(index)" class="alias-error" role="alert">
					{{ rowError(index) }}
				</div>
			</div>
		</div>
		<p v-else class="alias-empty">No aliases yet.</p>

		<div class="alias-actions">
			<button class="btn" type="button" @click="add">Add alias</button>
			<span class="alias-status" role="status">{{ statusText }}</span>
		</div>

		<h2>Variables</h2>
		<dl class="alias-vars">
			<dt><code>$1</code> … <code>$9</code></dt>
			<dd>one argument (empty when not given)</dd>
			<dt><code>$2-</code></dt>
			<dd>arguments from the 2nd to the last</dd>
			<dt><code>$*</code></dt>
			<dd>everything after the alias name</dd>
			<dt><code>$chan</code></dt>
			<dd>the current channel or query</dd>
			<dt><code>$me</code></dt>
			<dd>your nick on that network</dd>
			<dt><code>$$</code></dt>
			<dd>a literal <code>$</code></dd>
		</dl>
		<p class="alias-intro">
			A body line can invoke another alias, and an alias named after a built-in command
			replaces it — <code>/join</code> can become <code>/join #lobby $*</code> without
			looping.
		</p>

		<h2>Try it</h2>
		<input
			v-model="tryText"
			aria-label="Try an alias"
			class="input alias-try"
			type="text"
			:placeholder="tryPlaceholder"
			spellcheck="false"
			autocapitalize="off"
			autocomplete="off"
		/>
		<div v-if="tryText" class="alias-preview" aria-live="polite">
			<template v-if="preview">
				<code v-for="(line, index) in preview" :key="index" class="alias-preview-line">{{
					line
				}}</code>
			</template>
			<span v-else class="alias-preview-miss">
				Not an alias — this would be sent as typed.
			</span>
		</div>
	</div>
</template>

<style>
.settings-aliases .alias-intro,
.settings-aliases .alias-empty {
	color: var(--body-color-muted);
}

.settings-aliases .alias-table {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	margin-bottom: 0.75rem;
}

.settings-aliases .alias-head,
.settings-aliases .alias-row {
	display: grid;
	grid-template-columns: 9rem 1fr 2rem;
	gap: 0 0.5rem;
	align-items: start;
}

.settings-aliases .alias-head {
	color: var(--body-color-muted);
	font-size: 0.875em;
	text-transform: uppercase;
	letter-spacing: 0.05em;
}

.settings-aliases .alias-name-wrap {
	position: relative;
	display: block;
}

.settings-aliases .alias-slash {
	position: absolute;
	left: 0.55em;
	top: 50%;
	transform: translateY(-50%);
	color: var(--body-color-muted);
	font-family: Consolas, Menlo, Monaco, "Lucida Console", "DejaVu Sans Mono", "Courier New",
		monospace;
	pointer-events: none;
}

.settings-aliases .alias-name {
	padding-left: 1.4em;
	font-family: Consolas, Menlo, Monaco, "Lucida Console", "DejaVu Sans Mono", "Courier New",
		monospace;
}

.settings-aliases .alias-body {
	font-family: Consolas, Menlo, Monaco, "Lucida Console", "DejaVu Sans Mono", "Courier New",
		monospace;
	resize: vertical;
	min-height: 2.25rem;
}

/* The inputs carry the row: settings pages give .input a large bottom
 * margin that would double the grid gap here. */
.settings-aliases .alias-row .input {
	margin-bottom: 0;
}

.settings-aliases .alias-remove {
	height: 2.25rem;
	color: var(--body-color-muted);
}

.settings-aliases .alias-remove::before {
	font: normal normal normal 1em/1 FontAwesome;
	content: "\f1f8"; /* https://fontawesome.com/icons/trash */
}

.settings-aliases .alias-remove:hover,
.settings-aliases .alias-remove:focus {
	color: #e74c3c;
}

.settings-aliases .alias-row-invalid .input {
	border-color: #e74c3c;
}

.settings-aliases .alias-error {
	grid-column: 1 / -1;
	color: #e74c3c;
	font-size: 0.875em;
	padding-top: 0.25em;
}

.settings-aliases .alias-actions {
	display: flex;
	align-items: center;
	gap: 1rem;
}

.settings-aliases .alias-actions .btn {
	margin-bottom: 0;
}

.settings-aliases .alias-status {
	color: var(--body-color-muted);
	font-size: 0.875em;
}

.settings-aliases .alias-vars {
	display: grid;
	grid-template-columns: max-content 1fr;
	gap: 0.35rem 1rem;
	margin: 0 0 1em;
}

.settings-aliases .alias-vars dt {
	font-weight: normal;
}

.settings-aliases .alias-vars dd {
	margin: 0;
	color: var(--body-color-muted);
}

.settings-aliases .alias-try {
	font-family: Consolas, Menlo, Monaco, "Lucida Console", "DejaVu Sans Mono", "Courier New",
		monospace;
}

.settings-aliases .alias-preview {
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
	padding: 0.5rem 0.75rem;
	border-radius: 4px;
	background: rgb(128 128 128 / 12%);
}

.settings-aliases .alias-preview-line {
	display: block;
}

.settings-aliases .alias-preview-miss {
	color: var(--body-color-muted);
}
</style>

<script lang="ts">
import {computed, defineComponent, reactive, ref, watch} from "vue";
import {
	expandAlias,
	isValidAliasName,
	loadAliases,
	saveAliases,
	MAX_ALIASES,
	MAX_BODY_LENGTH,
	MAX_NAME_LENGTH,
	type Alias,
} from "../../js/helpers/aliases";

interface AliasRow extends Alias {
	/** Stable key for the row while names are being typed. */
	id: number;
}

export default defineComponent({
	name: "AliasSettings",
	setup() {
		let nextId = 1;
		const rows = reactive<AliasRow[]>(loadAliases().map((alias) => ({...alias, id: nextId++})));

		const tryText = ref("");

		/** Rows complete and consistent enough to persist and to preview. */
		const validRows = computed<Alias[]>(() => {
			const seen = new Set<string>();
			const list: Alias[] = [];

			for (const row of rows) {
				const key = row.name.toLowerCase();

				if (
					!isValidAliasName(row.name) ||
					row.body.trim().length === 0 ||
					row.body.length > MAX_BODY_LENGTH ||
					seen.has(key)
				) {
					continue;
				}

				seen.add(key);
				list.push({name: row.name, body: row.body});
			}

			return list;
		});

		// Every change persists at once, like the rest of the settings; a row
		// with an error simply is not part of what is saved yet.
		watch(validRows, (list) => saveAliases(list), {deep: true});

		const rowError = (index: number): string | null => {
			const row = rows[index];

			if (row.name.length === 0 && row.body.trim().length === 0) {
				return null; // a fresh row is not wrong, just not saved
			}

			if (row.name.length === 0) {
				return "Give the alias a name.";
			}

			if (!isValidAliasName(row.name)) {
				return "Names are letters, digits, - and _ — no spaces or slashes.";
			}

			for (let i = 0; i < index; i++) {
				if (rows[i].name.toLowerCase() === row.name.toLowerCase()) {
					return `There is already a /${rows[i].name}.`;
				}
			}

			if (row.body.trim().length === 0) {
				return "Say what the alias runs.";
			}

			if (row.body.length > MAX_BODY_LENGTH) {
				return `The body is too long (over ${MAX_BODY_LENGTH} characters).`;
			}

			return null;
		};

		const statusText = computed(() => {
			const saved = validRows.value.length;
			const broken = rows.filter((_, index) => rowError(index) !== null).length;
			const count = saved === 1 ? "1 alias" : `${saved} aliases`;

			return broken > 0
				? `${count} saved — rows with errors are not saved.`
				: rows.length > 0
				? `${count} saved.`
				: "";
		});

		const add = () => {
			if (rows.length >= MAX_ALIASES) {
				return;
			}

			rows.push({id: nextId++, name: "", body: ""});
		};

		const remove = (index: number) => {
			rows.splice(index, 1);
		};

		const bodyRows = (row: AliasRow) => Math.min(8, row.body.split("\n").length);

		const tryPlaceholder = computed(() =>
			validRows.value.length > 0 ? `/${validRows.value[0].name} some arguments` : "/wave bob"
		);

		const preview = computed(() =>
			expandAlias(tryText.value, {chan: "#channel", me: "yournick"}, validRows.value)
		);

		return {
			rows,
			rowError,
			statusText,
			add,
			remove,
			bodyRows,
			tryText,
			tryPlaceholder,
			preview,
			maxNameLength: MAX_NAME_LENGTH,
		};
	},
});
</script>
