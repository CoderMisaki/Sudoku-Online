import re

with open('src/app/room/[id]/page.tsx', 'r') as f:
    content = f.read()

# Replace Players Card content
content = re.sub(
    r'<div className="p-4 border-b border-border bg-background/50 flex items-center justify-between">',
    r'<div className="p-3 border-b border-border bg-background/50 flex items-center justify-between">',
    content
)
content = re.sub(
    r'<h2 className="font-semibold flex items-center gap-2">',
    r'<h2 className="font-semibold text-sm flex items-center gap-2">',
    content
)
content = re.sub(
    r'<span className="text-xs text-secondary bg-secondary/10 px-2 py-1 rounded-full">',
    r'<span className="text-xs text-secondary bg-secondary/10 px-2 py-0.5 rounded-full">',
    content
)
content = re.sub(
    r'<div className="p-4 overflow-y-auto flex-1 space-y-3">',
    r'<div className="p-3 overflow-y-auto flex-1 space-y-2 text-xs sm:text-sm">',
    content
)
content = re.sub(
    r'<div className="flex items-center gap-3">',
    r'<div className="flex items-center gap-2">',
    content
)
content = re.sub(
    r'<div\s+className="w-3 h-3 rounded-full"',
    r'<div\n                      className="w-2.5 h-2.5 rounded-full"',
    content
)
content = re.sub(
    r'<span className="text-sm font-medium">',
    r'<span className="font-medium">',
    content
)
content = re.sub(
    r'<span className="text-xs text-secondary">\(Host\)</span>',
    r'<span className="text-secondary">(Host)</span>',
    content
)
content = re.sub(
    r'<span className="text-sm font-mono">\{player\.score\}</span>',
    r'<span className="font-mono">{player.score}</span>',
    content
)

# Replace Chat Card container
# Note: we need to replace the SECOND occurrence of <Card className="flex-1 flex flex-col overflow-hidden max-h-[50vh] lg:max-h-none">
content = content.replace(
    '<Card className="flex-1 flex flex-col overflow-hidden max-h-[50vh] lg:max-h-none">',
    '<Card className="flex-1 flex flex-col overflow-hidden min-h-[200px] max-h-[300px] lg:max-h-none">'
)

# Replace Chat Card content
content = re.sub(
    r'<div className="p-4 border-b border-border bg-background/50">\s*<h2 className="font-semibold">Chat</h2>',
    r'<div className="p-3 border-b border-border bg-background/50">\n              <h2 className="font-semibold text-sm">Chat</h2>',
    content
)
content = re.sub(
    r'<div className="flex-1 p-4 flex flex-col overflow-y-auto space-y-2 text-sm">',
    r'<div className="flex-1 p-3 flex flex-col overflow-y-auto space-y-2 text-xs sm:text-sm">',
    content
)
content = re.sub(
    r'<span className="font-semibold text-xs">\{msg\.username\}</span>',
    r'<span className="font-semibold text-[11px] text-secondary">{msg.username}</span>',
    content
)
content = re.sub(
    r'<span className="bg-secondary/10 px-2 py-1 rounded-md w-fit max-w-full break-words">\{msg\.text\}</span>',
    r'<span className="bg-secondary/10 px-2.5 py-1 rounded-md w-fit max-w-full break-words text-xs">{msg.text}</span>',
    content
)
content = re.sub(
    r'<div className="p-3 border-t border-border">',
    r'<div className="p-2.5 border-t border-border">',
    content
)

# Replace chat form elements
content = re.sub(
    r'<textarea id="chat-textarea".*?</Button>\s*</form>',
    r'''<input
                  type="text"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
                />
                <Button type="submit" size="sm" className="h-8 px-3 text-xs">
                  Send
                </Button>
              </form>''',
    content,
    flags=re.DOTALL
)
content = re.sub(
    r'<form onSubmit=\{handleChatSubmit\} className="flex items-end gap-2">',
    r'<form onSubmit={handleChatSubmit} className="flex items-center gap-2">',
    content
)

with open('src/app/room/[id]/page.tsx', 'w') as f:
    f.write(content)
