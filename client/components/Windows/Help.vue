<template>
	<div id="help" class="window" role="tabpanel" :aria-label="title">
		<div class="header">
			<SidebarToggle />
		</div>
		<div class="container">
			<h1 class="title">{{ title }}</h1>

			<h2 class="help-version-title">
				<span>{{ t("help.about") }} {{ appName }}</span>
				<small>
					v{{ build.version }} (<router-link id="view-changelog" to="/changelog">{{
						t("help.releaseNotesLink")
					}}</router-link
					>)
				</small>
			</h2>

			<div class="about">
				<div
					v-if="store.state.serverConfiguration?.isUpdateAvailable"
					class="update-banner"
					role="status"
				>
					<span class="update-banner-icon" aria-hidden="true"></span>
					<span class="update-banner-text">{{ t("help.updateAvailable") }}</span>
					<button type="button" class="update-banner-reload" @click="reloadForUpdate">
						{{ t("help.reload") }}
					</button>
				</div>

				<template v-if="pastRelease">
					<p>
						{{ appName }} {{ t("help.builtFrom") }}
						<a :href="source.commit" target="_blank" rel="noopener"
							>{{ t("help.commitLink") }} <code>{{ build.gitCommit }}</code></a
						>{{ t("help.builtAfter", {version: build.release}) }}.
					</p>

					<ul>
						<li>
							{{ t("help.compare") }}
							<a :href="source.sinceRelease" target="_blank" rel="noopener"
								>{{ t("help.between") }} <code>v{{ build.release }}</code>
								{{ t("help.and") }}
								<code>{{ build.gitCommit }}</code></a
							>
							{{ t("help.sinceRelease") }}
						</li>
						<li>
							{{ t("help.compare") }}
							<a :href="source.behindDevelop" target="_blank" rel="noopener"
								>{{ t("help.between") }} <code>{{ build.gitCommit }}</code>
								{{ t("help.and") }}
								<code>develop</code></a
							>
							{{ t("help.behindDevelop") }}
						</li>
					</ul>
				</template>

				<p v-if="links.website">
					<a :href="links.website" target="_blank" rel="noopener" class="website-link">{{
						t("help.website")
					}}</a>
				</p>
				<p v-if="links.help">
					<a
						:href="links.help"
						target="_blank"
						rel="noopener"
						class="documentation-link"
						>{{ t("help.documentation") }}</a
					>
				</p>
				<p v-if="links.privacy">
					<a :href="links.privacy" target="_blank" rel="noopener" class="privacy-link">{{
						t("help.privacy")
					}}</a>
				</p>
				<p>
					<a
						:href="source.newIssue"
						target="_blank"
						rel="noopener"
						class="report-issue-link"
						>{{ t("help.reportIssue") }}</a
					>
				</p>
			</div>

			<h2 v-if="isTouch">{{ t("help.gestures.heading") }}</h2>

			<div v-if="isTouch" class="help-item">
				<div class="subject gesture">{{ t("help.gestures.swipeLeft") }}</div>
				<div class="description">
					<p>{{ t("help.gestures.hideSidebar") }}</p>
				</div>
			</div>

			<div v-if="isTouch" class="help-item">
				<div class="subject gesture">{{ t("help.gestures.swipeRight") }}</div>
				<div class="description">
					<p>{{ t("help.gestures.showSidebar") }}</p>
				</div>
			</div>

			<div v-if="isTouch" class="help-item">
				<div class="subject gesture">{{ t("help.gestures.twoSwipeLeft") }}</div>
				<div class="description">
					<p>{{ t("help.shortcuts.nextWindow") }}</p>
				</div>
			</div>

			<div v-if="isTouch" class="help-item">
				<div class="subject gesture">{{ t("help.gestures.twoSwipeRight") }}</div>
				<div class="description">
					<p>{{ t("help.shortcuts.prevWindow") }}</p>
				</div>
			</div>

			<h2>{{ t("help.shortcuts.heading") }}</h2>

			<div class="help-item">
				<div class="subject">
					<span v-if="!isApple"><kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>↓</kbd></span>
					<span v-else><kbd>⌥</kbd> <kbd>⇧</kbd> <kbd>↓</kbd></span>
				</div>
				<div class="description">
					<p>{{ t("help.shortcuts.nextLobby") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<span v-if="!isApple"><kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>↑</kbd></span>
					<span v-else><kbd>⌥</kbd> <kbd>⇧</kbd> <kbd>↑</kbd></span>
				</div>
				<div class="description">
					<p>{{ t("help.shortcuts.prevLobby") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<span v-if="!isApple"><kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>←</kbd></span>
					<span v-else><kbd>⌥</kbd> <kbd>⇧</kbd> <kbd>←</kbd></span>
				</div>
				<div class="description">
					<p>{{ t("help.shortcuts.collapseNetwork") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<span v-if="!isApple"><kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>→</kbd></span>
					<span v-else><kbd>⌥</kbd> <kbd>⇧</kbd> <kbd>→</kbd></span>
				</div>
				<div class="description">
					<p>{{ t("help.shortcuts.expandNetwork") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<span v-if="!isApple"><kbd>Alt</kbd> <kbd>↓</kbd></span>
					<span v-else><kbd>⌥</kbd> <kbd>↓</kbd></span>
				</div>
				<div class="description">
					<p>{{ t("help.shortcuts.nextWindow") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<span v-if="!isApple"><kbd>Alt</kbd> <kbd>↑</kbd></span>
					<span v-else><kbd>⌥</kbd> <kbd>↑</kbd></span>
				</div>
				<div class="description">
					<p>{{ t("help.shortcuts.prevWindow") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<span v-if="!isApple"><kbd>Alt</kbd> <kbd>Ctrl</kbd> <kbd>↓</kbd></span>
					<span v-else><kbd>⌥</kbd> <kbd>⌘</kbd> <kbd>↓</kbd></span>
				</div>
				<div class="description">
					<p>{{ t("help.shortcuts.nextUnread") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<span v-if="!isApple"><kbd>Alt</kbd> <kbd>Ctrl</kbd> <kbd>↑</kbd></span>
					<span v-else><kbd>⌥</kbd> <kbd>⌘</kbd> <kbd>↑</kbd></span>
				</div>
				<div class="description">
					<p>{{ t("help.shortcuts.prevUnread") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<span v-if="!isApple"><kbd>Alt</kbd> <kbd>A</kbd></span>
					<span v-else><kbd>⌥</kbd> <kbd>A</kbd></span>
				</div>
				<div class="description">
					<p>{{ t("help.shortcuts.firstUnread") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<span v-if="!isApple"><kbd>Alt</kbd> <kbd>S</kbd></span>
					<span v-else><kbd>⌥</kbd> <kbd>S</kbd></span>
				</div>
				<div class="description">
					<p>{{ t("help.shortcuts.toggleSidebar") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<span v-if="!isApple"><kbd>Alt</kbd> <kbd>U</kbd></span>
					<span v-else><kbd>⌥</kbd> <kbd>U</kbd></span>
				</div>
				<div class="description">
					<p>{{ t("help.shortcuts.toggleUserlist") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<span v-if="!isApple"><kbd>Alt</kbd> <kbd>J</kbd></span>
					<span v-else><kbd>⌥</kbd> <kbd>J</kbd></span>
				</div>
				<div class="description">
					<p>{{ t("help.shortcuts.toggleJump") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<span v-if="!isApple"><kbd>Alt</kbd> <kbd>M</kbd></span>
					<span v-else><kbd>⌥</kbd> <kbd>M</kbd></span>
				</div>
				<div class="description">
					<p>{{ t("help.shortcuts.toggleMentions") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<span v-if="!isApple"><kbd>Alt</kbd> <kbd>K</kbd></span>
					<span v-else><kbd>⌥</kbd> <kbd>K</kbd></span>
				</div>
				<div class="description">
					<p>{{ t("help.shortcuts.toggleMarkdown") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<span v-if="!isApple"><kbd>Alt</kbd> <kbd>/</kbd></span>
					<span v-else><kbd>⌥</kbd> <kbd>/</kbd></span>
				</div>
				<div class="description">
					<p>{{ t("help.shortcuts.helpMenu") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<span><kbd>Esc</kbd></span>
				</div>
				<div class="description">
					<p>
						{{ t("help.shortcuts.escape") }}
					</p>
				</div>
			</div>

			<h2>{{ t("help.formatting.heading") }}</h2>

			<div class="help-item">
				<div class="subject">
					<span v-if="!isApple"><kbd>Ctrl</kbd> <kbd>K</kbd></span>
					<span v-else><kbd>⌘</kbd> <kbd>K</kbd></span>
				</div>
				<div class="description">
					<p>
						{{ t("help.formatting.colorP1a") }}
						<code>0—15</code>
						{{ t("help.formatting.colorP1b") }}
					</p>
					<p>
						{{ t("help.formatting.colorP2a") }}
						<code>0—15</code>
						{{ t("help.formatting.colorP2b") }}
					</p>
					<p>
						{{ t("help.formatting.colorRef") }}
						<a
							href="https://modern.ircdocs.horse/formatting.html#colors"
							target="_blank"
							rel="noopener"
							>{{ t("help.formatting.colorHere") }}</a
						>.
					</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<span v-if="!isApple"><kbd>Ctrl</kbd> <kbd>B</kbd></span>
					<span v-else><kbd>⌘</kbd> <kbd>B</kbd></span>
				</div>
				<div class="description">
					<p>
						{{ t("help.formatting.as") }}
						<span class="irc-bold">{{ t("help.formatting.bold") }}</span
						>.
					</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<span v-if="!isApple"><kbd>Ctrl</kbd> <kbd>U</kbd></span>
					<span v-else><kbd>⌘</kbd> <kbd>U</kbd></span>
				</div>
				<div class="description">
					<p>
						{{ t("help.formatting.as") }}
						<span class="irc-underline">{{ t("help.formatting.underline") }}</span
						>.
					</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<span v-if="!isApple"><kbd>Ctrl</kbd> <kbd>I</kbd></span>
					<span v-else><kbd>⌘</kbd> <kbd>I</kbd></span>
				</div>
				<div class="description">
					<p>
						{{ t("help.formatting.as") }}
						<span class="irc-italic">{{ t("help.formatting.italic") }}</span
						>.
					</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<span v-if="!isApple"><kbd>Ctrl</kbd> <kbd>S</kbd></span>
					<span v-else><kbd>⌘</kbd> <kbd>S</kbd></span>
				</div>
				<div class="description">
					<p>
						{{ t("help.formatting.as") }}
						<span class="irc-strikethrough">{{
							t("help.formatting.strikethrough")
						}}</span
						>.
					</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<span v-if="!isApple"><kbd>Ctrl</kbd> <kbd>M</kbd></span>
					<span v-else><kbd>⌘</kbd> <kbd>M</kbd></span>
				</div>
				<div class="description">
					<p>
						{{ t("help.formatting.as") }}
						<span class="irc-monospace">{{ t("help.formatting.monospace") }}</span
						>.
					</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<span v-if="!isApple"><kbd>Ctrl</kbd> <kbd>O</kbd></span>
					<span v-else><kbd>⌘</kbd> <kbd>O</kbd></span>
				</div>
				<div class="description">
					<p>
						{{ t("help.formatting.reset") }}
					</p>
				</div>
			</div>

			<h2>{{ t("help.autocomplete.heading") }}</h2>

			<p>
				{{ t("help.autocomplete.introA") }}
				<kbd>↑</kbd> {{ t("help.autocomplete.introB") }} <kbd>↓</kbd>
				{{ t("help.autocomplete.introC") }} <kbd>Tab</kbd>
				{{ t("help.autocomplete.introD") }} <kbd>Enter</kbd>
				{{ t("help.autocomplete.introE") }}
			</p>
			<p>{{ t("help.autocomplete.disabled") }}</p>

			<div class="help-item">
				<div class="subject">
					<code>@</code>
				</div>
				<div class="description">
					<p>{{ t("help.autocomplete.nick") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>#</code>
				</div>
				<div class="description">
					<p>{{ t("help.autocomplete.channel") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/</code>
				</div>
				<div class="description">
					<p>{{ t("help.autocomplete.commands") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>:</code>
				</div>
				<div class="description">
					<p>
						{{ t("help.autocomplete.emoji") }}
						<code>:)</code>)
					</p>
				</div>
			</div>

			<h2>{{ t("help.commands.heading") }}</h2>

			<div class="help-item">
				<div class="subject">
					<code>/away [message]</code>
				</div>
				<div class="description">
					<p>{{ t("help.commands.away") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/back</code>
				</div>
				<div class="description">
					<p>{{ t("help.commands.back") }} <code>/away</code>).</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/ban nick</code>
				</div>
				<div class="description">
					<p>
						{{ t("help.commands.banA") }} <code>+b</code>{{ t("help.commands.banB") }}
					</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/banlist</code>
				</div>
				<div class="description">
					<p>{{ t("help.commands.banlist") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/collapse</code>
				</div>
				<div class="description">
					<p>
						{{ t("help.commands.collapse") }}
						<code>/expand</code>)
					</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/connect host [port]</code>
				</div>
				<div class="description">
					<p>
						{{ t("help.commands.connectA") }} <code>port</code>
						{{ t("help.commands.connectB") }}
						<code>+</code> {{ t("help.commands.connectC") }}
					</p>
					<p>{{ t("help.commands.alias") }} <code>/server</code></p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/ctcp target cmd [args]</code>
				</div>
				<div class="description">
					<p>
						{{ t("help.commands.ctcpA") }} <abbr :title="ctcpTitle">CTCP</abbr>
						{{ t("help.commands.ctcpB") }}
						<a
							href="https://en.wikipedia.org/wiki/Client-to-client_protocol"
							target="_blank"
							rel="noopener"
							>{{ t("help.commands.ctcpLink") }}</a
						>.
					</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/deop nick [...nick]</code>
				</div>
				<div class="description">
					<p>
						{{ t("help.commands.deopA") }} <code>-o</code>{{ t("help.commands.deopB") }}
					</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/devoice nick [...nick]</code>
				</div>
				<div class="description">
					<p>
						{{ t("help.commands.devoiceA") }} <code>-v</code
						>{{ t("help.commands.devoiceB") }}
					</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/disconnect [message]</code>
				</div>
				<div class="description">
					<p>{{ t("help.commands.disconnectLong") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/expand</code>
				</div>
				<div class="description">
					<p>
						{{ t("help.commands.expand") }}
						<code>/collapse</code>)
					</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/invite nick [channel]</code>
				</div>
				<div class="description">
					<p>
						{{ t("help.commands.inviteA") }}
						<code>channel</code> {{ t("help.commands.inviteB") }}
					</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/ignore nick</code>
				</div>
				<div class="description">
					<p>
						{{ t("help.commands.ignore") }}
					</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/ignorelist</code>
				</div>
				<div class="description">
					<p>{{ t("help.commands.ignorelist") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/join channel [password]</code>
				</div>
				<div class="description">
					<p>
						{{ t("help.commands.join") }}
					</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/kick nick [reason]</code>
				</div>
				<div class="description">
					<p>{{ t("help.commands.kick") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/kickban nick [reason]</code>
				</div>
				<div class="description">
					<p>
						{{ t("help.commands.kickbanA") }} <code>+b</code
						>{{ t("help.commands.kickbanB") }} <code>/ban</code
						>{{ t("help.commands.kickbanC") }}
					</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/list</code>
				</div>
				<div class="description">
					<p>{{ t("help.commands.list") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/me message</code>
				</div>
				<div class="description">
					<p>
						{{ t("help.commands.me", {appName}) }}
					</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/mode flags [args]</code>
				</div>
				<div class="description">
					<p>
						{{ t("help.commands.mode") }}
					</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/msg channel message</code>
				</div>
				<div class="description">
					<p>{{ t("help.commands.msg") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/mute [...channel]</code>
				</div>
				<div class="description">
					<p>{{ t("help.commands.mute") }} <code>/unmute</code>.</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/nick newnick</code>
				</div>
				<div class="description">
					<p>{{ t("help.commands.nick") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/notice channel message</code>
				</div>
				<div class="description">
					<p>{{ t("help.commands.notice") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/op nick [...nick]</code>
				</div>
				<div class="description">
					<p>{{ t("help.commands.opA") }} <code>+o</code>{{ t("help.commands.opB") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/part [channel]</code>
				</div>
				<div class="description">
					<p>
						{{ t("help.commands.part") }}
						<code>channel</code> {{ t("help.commands.partB") }}
					</p>
					<p>{{ t("help.commands.aliases") }} <code>/close</code>, <code>/leave</code></p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/rejoin</code>
				</div>
				<div class="description">
					<p>
						{{ t("help.commands.rejoin") }}
					</p>
					<p>{{ t("help.commands.alias") }} <code>/cycle</code></p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/query nick</code>
				</div>
				<div class="description">
					<p>{{ t("help.commands.query") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/quit [message]</code>
				</div>
				<div class="description">
					<p>{{ t("help.commands.quit") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/raw message</code>
				</div>
				<div class="description">
					<p>{{ t("help.commands.raw") }}</p>
					<p>{{ t("help.commands.aliases") }} <code>/quote</code>, <code>/send</code></p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/slap nick</code>
				</div>
				<div class="description">
					<p>{{ t("help.commands.slap") }}</p>
				</div>
			</div>

			<div v-if="store.state.settings.searchEnabled" class="help-item">
				<div class="subject">
					<code>/search query</code>
				</div>
				<div class="description">
					<p>{{ t("help.commands.search") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/topic [newtopic]</code>
				</div>
				<div class="description">
					<p>
						{{ t("help.commands.topicA") }} <code>newtopic</code>
						{{ t("help.commands.topicB") }}
					</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/cleartopic</code>
				</div>
				<div class="description">
					<p>{{ t("help.commands.cleartopic") }}</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/unban nick</code>
				</div>
				<div class="description">
					<p>
						{{ t("help.commands.unbanA") }} <code>-b</code
						>{{ t("help.commands.unbanB") }}
					</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/unignore nick</code>
				</div>
				<div class="description">
					<p>
						{{ t("help.commands.unignore") }}
					</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/unmute [...channel]</code>
				</div>
				<div class="description">
					<p>
						{{ t("help.commands.unmuteA") }} <code>/mute</code>
						{{ t("help.commands.unmuteB") }}
					</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/voice nick [...nick]</code>
				</div>
				<div class="description">
					<p>
						{{ t("help.commands.voiceA") }} <code>+v</code
						>{{ t("help.commands.voiceB") }}
					</p>
				</div>
			</div>

			<div class="help-item">
				<div class="subject">
					<code>/whois nick</code>
				</div>
				<div class="description">
					<p>{{ t("help.commands.whois") }}</p>
				</div>
			</div>
		</div>
	</div>
</template>

<script lang="ts">
import {computed, defineComponent, ref} from "vue";
import {useStore} from "../../js/store";
import {useI18n} from "../../js/i18n";
import {buildIdentityOf, isPastRelease, sourceLinks} from "../../js/helpers/sourceLinks";
import SidebarToggle from "../SidebarToggle.vue";

export default defineComponent({
	name: "Help",
	components: {
		SidebarToggle,
	},
	setup() {
		const store = useStore();
		const {t} = useI18n();
		const title = computed(() => t("help.title"));
		const ctcpTitle = computed(() => t("help.commands.ctcpTitle"));
		const isApple = navigator.platform.match(/(Mac|iPhone|iPod|iPad)/i) || false;
		const isTouch = navigator.maxTouchPoints > 0;
		const appName = computed(() => store.state.branding.appName);
		const links = computed(() => store.state.branding.links ?? {});

		// What this build is (configuration.ts, filled in by webpack) and
		// where it comes from (branding.links.source).
		const build = computed(() => buildIdentityOf(store.state.serverConfiguration));
		const pastRelease = computed(() => isPastRelease(build.value));
		const source = computed(() => sourceLinks(links.value.source, build.value));

		// Installed PWAs have no reload button; a newer build's worker flags
		// itself in the store (see pwa.ts) and this picks it up.
		const reloadForUpdate = () => window.location.reload();

		return {
			title,
			ctcpTitle,
			appName,
			build,
			isApple,
			isTouch,
			links,
			pastRelease,
			reloadForUpdate,
			source,
			store,
			t,
		};
	},
});
</script>
