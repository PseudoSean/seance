/**
 * TOPIC and the 331/332/333 replies.
 */

import {MessageType} from "../../../../shared/types/msg";
import type {Handler} from "../types";

const topicChange: Handler = (client, msg) => {
	const [name, topic = ""] = msg.params;
	const chan = name ? client.findChannel(name) : undefined;
	const nick = msg.source?.name ?? "";

	if (!chan) {
		return;
	}

	client.pushMessage(chan, {
		type: MessageType.TOPIC,
		time: client.timeOf(msg),
		from: chan.userRef(nick),
		text: topic,
		self: client.isSelf(nick),
	});

	if (client.replaying) {
		return; // history: the current topic came from 332
	}

	chan.shared.topic = topic;
	client.dispatch("topic", {chan: chan.id, topic});
};

// RPL_TOPIC: <me> <channel> :<topic>
const rplTopic: Handler = (client, msg) => {
	const [, name, topic = ""] = msg.params;
	const chan = name ? client.findChannel(name) : undefined;

	if (!chan) {
		return;
	}

	// The JOIN burst of a re-join / session restore repeats the topic we
	// already show: say nothing unless it changed while we were away.
	chan.topicQuiet = (chan.rejoining || client.restoring) && topic === chan.shared.topic;

	if (chan.topicQuiet) {
		return;
	}

	client.pushMessage(chan, {type: MessageType.TOPIC, time: client.timeOf(msg), text: topic});
	chan.shared.topic = topic;
	client.dispatch("topic", {chan: chan.id, topic});
};

// RPL_NOTOPIC: <me> <channel> :No topic is set
const rplNoTopic: Handler = (client, msg) => {
	const chan = msg.params[1] ? client.findChannel(msg.params[1]) : undefined;

	if (!chan) {
		return;
	}

	chan.topicQuiet = false;
	chan.shared.topic = "";
	client.dispatch("topic", {chan: chan.id, topic: ""});
};

// RPL_TOPICWHOTIME: <me> <channel> <setter> <unix time>
const rplTopicWhoTime: Handler = (client, msg) => {
	const [, name, setter = "", when = ""] = msg.params;
	const chan = name ? client.findChannel(name) : undefined;

	if (!chan) {
		return;
	}

	if (chan.topicQuiet) {
		chan.topicQuiet = false;
		return;
	}

	const nick = setter.split("!")[0];
	const seconds = parseInt(when, 10);

	client.pushMessage(chan, {
		type: MessageType.TOPIC_SET_BY,
		time: client.timeOf(msg),
		from: chan.userRef(nick),
		when: Number.isNaN(seconds) ? new Date() : new Date(seconds * 1000),
		self: client.isSelf(nick),
	});
};

export default {TOPIC: topicChange, "331": rplNoTopic, "332": rplTopic, "333": rplTopicWhoTime};
