/*
 * Vencord MessageEvents API - Plugin Integration
 * Enhanced with detailed debugging and logging
 */

// Mock types for Vencord environment
interface Channel {
    id: string;
    name?: string;
    type?: number;
}

interface CloudUpload {
    id: string;
    filename: string;
}

interface CustomEmoji {
    id: string;
    name: string;
    animated?: boolean;
}

interface Message {
    id: string;
    content?: string;
    author?: { id: string };
    channel_id: string;
    timestamp: string;
    messageReference?: {
        message_id?: string;
        channel_id?: string;
        guild_id?: string;
    };
}

// Mock MessageStore for Vencord environment
const MessageStore = {
    getMessage: (channelId: string, messageId: string): Message | null => {
        console.log(`[DEBUG] MessageStore.getMessage called with channelId: ${channelId}, messageId: ${messageId}`);
        // In Vencord, this would return the actual message from the store
        return null;
    }
};

type Promisable<T> = Promise<T> | T;

// Enhanced debug logging utility
const DebugLogger = {
    log: (message: string, data?: any) => {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [DEBUG] MessageEvents: ${message}`, data || '');
    },
    error: (message: string, error?: any) => {
        const timestamp = new Date().toISOString();
        console.error(`[${timestamp}] [ERROR] MessageEvents: ${message}`, error || '');
    },
    warn: (message: string, data?: any) => {
        const timestamp = new Date().toISOString();
        console.warn(`[${timestamp}] [WARN] MessageEvents: ${message}`, data || '');
    },
    info: (message: string, data?: any) => {
        const timestamp = new Date().toISOString();
        console.info(`[${timestamp}] [INFO] MessageEvents: ${message}`, data || '');
    }
};

// Simple logger implementation for Vencord environment
class Logger {
    constructor(private name: string, private color: string) {}
    
    log(message: string, ...args: any[]) {
        console.log(`[${this.name}] ${message}`, ...args);
    }
    
    error(message: string, ...args: any[]) {
        console.error(`[${this.name}] ERROR: ${message}`, ...args);
    }
    
    warn(message: string, ...args: any[]) {
        console.warn(`[${this.name}] WARN: ${message}`, ...args);
    }
    
    info(message: string, ...args: any[]) {
        console.info(`[${this.name}] INFO: ${message}`, ...args);
    }
}

const MessageEventsLogger = new Logger("MessageEvents", "#e5c890");

export interface MessageObject {
    content: string,
    validNonShortcutEmojis: CustomEmoji[];
    invalidEmojis: any[];
    tts: boolean;
}

export interface MessageReplyOptions {
    messageReference: Message["messageReference"];
    allowedMentions?: {
        parse: Array<string>;
        users?: Array<string>;
        roles?: Array<string>;
        repliedUser: boolean;
    };
}

export interface MessageOptions {
    stickers?: string[];
    uploads?: CloudUpload[];
    replyOptions: MessageReplyOptions;
    content: string;
    channel: Channel;
    type?: any;
    openWarningPopout: (props: any) => any;
}

export type MessageSendListener = (channelId: string, messageObj: MessageObject, options: MessageOptions) => Promisable<void | { cancel: boolean; }>;
export type MessageEditListener = (channelId: string, messageId: string, messageObj: MessageObject) => Promisable<void | { cancel: boolean; }>;

const sendListeners = new Set<MessageSendListener>();
const editListeners = new Set<MessageEditListener>();

// Enhanced logging for listener management
DebugLogger.log(`Initializing MessageEvents with ${sendListeners.size} send listeners and ${editListeners.size} edit listeners`);

export async function _handlePreSend(channelId: string, messageObj: MessageObject, options: MessageOptions, replyOptions: MessageReplyOptions) {
    DebugLogger.log("=== MESSAGE PRE-SEND HANDLER STARTED ===");
    DebugLogger.log("Channel ID:", channelId);
    DebugLogger.log("Message Object:", {
        content: messageObj.content,
        contentLength: messageObj.content?.length || 0,
        validEmojisCount: messageObj.validNonShortcutEmojis?.length || 0,
        invalidEmojisCount: messageObj.invalidEmojis?.length || 0,
        tts: messageObj.tts
    });
    DebugLogger.log("Options:", {
        hasStickers: !!options.stickers?.length,
        stickersCount: options.stickers?.length || 0,
        hasUploads: !!options.uploads?.length,
        uploadsCount: options.uploads?.length || 0,
        hasReplyOptions: !!replyOptions,
        channelId: options.channel?.id,
        channelName: options.channel?.name,
        channelType: options.channel?.type
    });
    DebugLogger.log("Reply Options:", {
        hasMessageReference: !!replyOptions.messageReference,
        messageReferenceId: replyOptions.messageReference?.message_id,
        channelId: replyOptions.messageReference?.channel_id,
        guildId: replyOptions.messageReference?.guild_id,
        allowedMentions: replyOptions.allowedMentions
    });

    options.replyOptions = replyOptions;
    
    DebugLogger.log(`Processing ${sendListeners.size} send listeners`);
    
    for (const [index, listener] of Array.from(sendListeners).entries()) {
        try {
            DebugLogger.log(`Executing send listener ${index + 1}/${sendListeners.size}`);
            const startTime = performance.now();
            
            const result = await listener(channelId, messageObj, options);
            
            const endTime = performance.now();
            const duration = endTime - startTime;
            
            DebugLogger.log(`Send listener ${index + 1} completed in ${duration.toFixed(2)}ms`);
            DebugLogger.log(`Send listener ${index + 1} result:`, result);
            
            if (result?.cancel) {
                DebugLogger.warn(`Message send cancelled by listener ${index + 1}`);
                MessageEventsLogger.warn("Message send was cancelled by a listener", { listenerIndex: index + 1, channelId, messageContent: messageObj.content });
                return true;
            }
        } catch (e) {
            const errorMessage = `Send listener ${index + 1} encountered an error`;
            DebugLogger.error(errorMessage, e);
            MessageEventsLogger.error("MessageSendHandler: Listener encountered an unknown error", {
                listenerIndex: index + 1,
                totalListeners: sendListeners.size,
                channelId,
                error: e
            });
        }
    }
    
    DebugLogger.log("=== MESSAGE PRE-SEND HANDLER COMPLETED ===");
    return false;
}

export async function _handlePreEdit(channelId: string, messageId: string, messageObj: MessageObject) {
    DebugLogger.log("=== MESSAGE PRE-EDIT HANDLER STARTED ===");
    DebugLogger.log("Channel ID:", channelId);
    DebugLogger.log("Message ID:", messageId);
    DebugLogger.log("Message Object:", {
        content: messageObj.content,
        contentLength: messageObj.content?.length || 0,
        validEmojisCount: messageObj.validNonShortcutEmojis?.length || 0,
        invalidEmojisCount: messageObj.invalidEmojis?.length || 0,
        tts: messageObj.tts
    });

    DebugLogger.log(`Processing ${editListeners.size} edit listeners`);
    
    for (const [index, listener] of Array.from(editListeners).entries()) {
        try {
            DebugLogger.log(`Executing edit listener ${index + 1}/${editListeners.size}`);
            const startTime = performance.now();
            
            const result = await listener(channelId, messageId, messageObj);
            
            const endTime = performance.now();
            const duration = endTime - startTime;
            
            DebugLogger.log(`Edit listener ${index + 1} completed in ${duration.toFixed(2)}ms`);
            DebugLogger.log(`Edit listener ${index + 1} result:`, result);
            
            if (result?.cancel) {
                DebugLogger.warn(`Message edit cancelled by listener ${index + 1}`);
                MessageEventsLogger.warn("Message edit was cancelled by a listener", { 
                    listenerIndex: index + 1, 
                    channelId, 
                    messageId, 
                    messageContent: messageObj.content 
                });
                return true;
            }
        } catch (e) {
            const errorMessage = `Edit listener ${index + 1} encountered an error`;
            DebugLogger.error(errorMessage, e);
            MessageEventsLogger.error("MessageEditHandler: Listener encountered an unknown error", {
                listenerIndex: index + 1,
                totalListeners: editListeners.size,
                channelId,
                messageId,
                error: e
            });
        }
    }
    
    DebugLogger.log("=== MESSAGE PRE-EDIT HANDLER COMPLETED ===");
    return false;
}

/**
 * Note: This event fires off before a message is sent, allowing you to edit the message.
 */
export function addMessagePreSendListener(listener: MessageSendListener) {
    DebugLogger.log("Adding message pre-send listener");
    DebugLogger.log("Listener function:", listener.toString().substring(0, 100) + "...");
    
    sendListeners.add(listener);
    
    DebugLogger.log(`Message pre-send listener added. Total listeners: ${sendListeners.size}`);
    MessageEventsLogger.info("Message pre-send listener registered", { totalListeners: sendListeners.size });
    
    return listener;
}

/**
 * Note: This event fires off before a message's edit is applied, allowing you to further edit the message.
 */
export function addMessagePreEditListener(listener: MessageEditListener) {
    DebugLogger.log("Adding message pre-edit listener");
    DebugLogger.log("Listener function:", listener.toString().substring(0, 100) + "...");
    
    editListeners.add(listener);
    
    DebugLogger.log(`Message pre-edit listener added. Total listeners: ${editListeners.size}`);
    MessageEventsLogger.info("Message pre-edit listener registered", { totalListeners: editListeners.size });
    
    return listener;
}

export function removeMessagePreSendListener(listener: MessageSendListener) {
    DebugLogger.log("Removing message pre-send listener");
    
    const removed = sendListeners.delete(listener);
    
    DebugLogger.log(`Message pre-send listener ${removed ? 'removed' : 'not found'}. Total listeners: ${sendListeners.size}`);
    MessageEventsLogger.info("Message pre-send listener removed", { removed, totalListeners: sendListeners.size });
    
    return removed;
}

export function removeMessagePreEditListener(listener: MessageEditListener) {
    DebugLogger.log("Removing message pre-edit listener");
    
    const removed = editListeners.delete(listener);
    
    DebugLogger.log(`Message pre-edit listener ${removed ? 'removed' : 'not found'}. Total listeners: ${editListeners.size}`);
    MessageEventsLogger.info("Message pre-edit listener removed", { removed, totalListeners: editListeners.size });
    
    return removed;
}

// Message clicks
export type MessageClickListener = (message: Message, channel: Channel, event: MouseEvent) => void;

const listeners = new Set<MessageClickListener>();

DebugLogger.log(`Initializing MessageClick handlers with ${listeners.size} click listeners`);

export function _handleClick(message: Message, channel: Channel, event: MouseEvent) {
    DebugLogger.log("=== MESSAGE CLICK HANDLER STARTED ===");
    DebugLogger.log("Original message:", {
        id: message.id,
        content: message.content ? message.content.substring(0, 100) + (message.content.length > 100 ? '...' : '') : 'No content',
        authorId: message.author?.id,
        channelId: message.channel_id,
        timestamp: message.timestamp
    });
    DebugLogger.log("Channel:", {
        id: channel.id,
        name: channel.name,
        type: channel.type,
        guildId: (channel as any).guild_id
    });
    DebugLogger.log("Mouse event:", {
        type: event.type,
        button: event.button,
        clientX: event.clientX,
        clientY: event.clientY,
        target: event.target
    });

    // message object may be outdated, so (try to) fetch latest one
    const originalMessageId = message.id;
    const updatedMessage = MessageStore.getMessage(channel.id, message.id) ?? message;
    
    if (updatedMessage !== message) {
        DebugLogger.log("Message was updated from store", {
            originalId: originalMessageId,
            updatedId: updatedMessage.id,
            contentChanged: updatedMessage.content !== message.content
        });
    } else {
        DebugLogger.log("Using original message (no updates found in store)");
    }
    
    DebugLogger.log(`Processing ${listeners.size} click listeners`);
    
    for (const [index, listener] of Array.from(listeners).entries()) {
        try {
            DebugLogger.log(`Executing click listener ${index + 1}/${listeners.size}`);
            const startTime = performance.now();
            
            listener(updatedMessage, channel, event);
            
            const endTime = performance.now();
            const duration = endTime - startTime;
            
            DebugLogger.log(`Click listener ${index + 1} completed in ${duration.toFixed(2)}ms`);
        } catch (e) {
            const errorMessage = `Click listener ${index + 1} encountered an error`;
            DebugLogger.error(errorMessage, e);
            MessageEventsLogger.error("MessageClickHandler: Listener encountered an unknown error", {
                listenerIndex: index + 1,
                totalListeners: listeners.size,
                messageId: updatedMessage.id,
                channelId: channel.id,
                error: e
            });
        }
    }
    
    DebugLogger.log("=== MESSAGE CLICK HANDLER COMPLETED ===");
}

export function addMessageClickListener(listener: MessageClickListener) {
    DebugLogger.log("Adding message click listener");
    DebugLogger.log("Listener function:", listener.toString().substring(0, 100) + "...");
    
    listeners.add(listener);
    
    DebugLogger.log(`Message click listener added. Total listeners: ${listeners.size}`);
    MessageEventsLogger.info("Message click listener registered", { totalListeners: listeners.size });
    
    return listener;
}

export function removeMessageClickListener(listener: MessageClickListener) {
    DebugLogger.log("Removing message click listener");
    
    const removed = listeners.delete(listener);
    
    DebugLogger.log(`Message click listener ${removed ? 'removed' : 'not found'}. Total listeners: ${listeners.size}`);
    MessageEventsLogger.info("Message click listener removed", { removed, totalListeners: listeners.size });
    
    return removed;
}

// Additional utility functions for debugging
export function getListenerStats() {
    const stats = {
        sendListeners: sendListeners.size,
        editListeners: editListeners.size,
        clickListeners: listeners.size,
        timestamp: new Date().toISOString()
    };
    
    DebugLogger.log("Listener statistics:", stats);
    return stats;
}

export function clearAllListeners() {
    DebugLogger.warn("Clearing all listeners");
    
    const beforeStats = {
        sendListeners: sendListeners.size,
        editListeners: editListeners.size,
        clickListeners: listeners.size
    };
    
    sendListeners.clear();
    editListeners.clear();
    listeners.clear();
    
    DebugLogger.log("All listeners cleared", {
        before: beforeStats,
        after: { sendListeners: 0, editListeners: 0, clickListeners: 0 }
    });
    
    MessageEventsLogger.warn("All message event listeners cleared", beforeStats);
}
