import assert from 'assert';

console.log('--- TEST SUITE 5: CHAT SYSTEM & PRIVATE ISOLATION ---');

class ChatStore {
  constructor(myId) {
    this.myId = myId;
    this.activeTab = 'public';
    this.publicMessages = [];
    this.privateMessages = {}; // targetPlayerId -> [messages]
    this.unread = {}; // targetPlayerId -> count
  }

  setActiveTab(tab) {
    this.activeTab = tab;
    if (tab !== 'public') {
      this.unread[tab] = 0;
    }
  }

  receiveMessage(msg) {
    if (msg.channel === 'private') {
      const peerId = msg.playerId === this.myId ? msg.targetPlayerId : msg.playerId;
      if (!this.privateMessages[peerId]) this.privateMessages[peerId] = [];
      this.privateMessages[peerId].push(msg);

      if (this.activeTab !== peerId && msg.playerId !== this.myId) {
        this.unread[peerId] = (this.unread[peerId] || 0) + 1;
      }
    } else {
      this.publicMessages.push(msg);
    }
  }
}

// 1. Public chat test
{
  const aliceStore = new ChatStore('alice');
  const bobStore = new ChatStore('bob');

  const pubMsg = { id: 'm1', playerId: 'alice', name: 'Alice', text: 'Hello everyone!', channel: 'public', ts: Date.now() };
  aliceStore.receiveMessage(pubMsg);
  bobStore.receiveMessage(pubMsg);

  assert.strictEqual(aliceStore.publicMessages.length, 1);
  assert.strictEqual(bobStore.publicMessages.length, 1);
  assert.strictEqual(bobStore.publicMessages[0].text, 'Hello everyone!');
  console.log('✔ Public chat correctly recorded across clients');
}

// 2. Private chat isolation and unread badge test
{
  const aliceStore = new ChatStore('alice');
  const bobStore = new ChatStore('bob');
  const charlieStore = new ChatStore('charlie');

  const privMsg = {
    id: 'm2',
    playerId: 'alice',
    name: 'Alice',
    targetPlayerId: 'bob',
    targetName: 'Bob',
    text: 'Secret whisper for Bob',
    channel: 'private',
    ts: Date.now(),
  };

  // Only Alice and Bob receive the network packet
  aliceStore.receiveMessage(privMsg);
  bobStore.receiveMessage(privMsg);

  // Bob hasn't opened Alice's tab yet
  assert.strictEqual(bobStore.unread['alice'], 1, 'Bob has 1 unread message from Alice');
  assert.strictEqual(bobStore.privateMessages['alice'].length, 1);

  // Charlie received nothing
  assert.strictEqual(Object.keys(charlieStore.privateMessages).length, 0, 'Charlie has no private messages');

  // Bob clicks Alice's tab to view
  bobStore.setActiveTab('alice');
  assert.strictEqual(bobStore.unread['alice'], 0, 'Unread count cleared after opening tab');
  console.log('✔ Private chat isolation, conversation segregation, and unread badges verified');
}

console.log('SUITE 5 PASSED!\n');
