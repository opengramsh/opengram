import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Archive, ArchiveRestore, Pin, PinOff, Trash2 } from 'lucide-react';

import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Badge } from '@/src/components/ui/badge';
import { Drawer, DrawerContent } from '@/src/components/ui/drawer';
import { archiveChat, unarchiveChat, deleteChat, patchChat } from '../_lib/api';
import { useChatV2Context } from './chat-v2-provider';

export function ChatV2SettingsDrawer() {
  const { data } = useChatV2Context();
  const navigate = useNavigate();
  const { chat, isChatSettingsOpen, setIsChatSettingsOpen, setChat, setError } = data;
  const [titleInput, setTitleInput] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!chat) return null;

  const handleOpen = (open: boolean) => {
    if (open) setTitleInput(chat.title);
    setConfirmDelete(false);
    setIsChatSettingsOpen(open);
  };

  const saveTitle = async () => {
    const trimmed = titleInput.trim();
    if (!trimmed || trimmed === chat.title) return;
    setIsUpdating(true);
    try {
      const updated = await patchChat(chat.id, { title: trimmed });
      setChat(updated);
    } catch {
      setError('Failed to update title.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleArchive = async () => {
    setIsUpdating(true);
    try {
      if (chat.is_archived) {
        await unarchiveChat(chat.id);
        setChat((c) => c ? { ...c, is_archived: false } : c);
      } else {
        await archiveChat(chat.id);
        setChat((c) => c ? { ...c, is_archived: true } : c);
        setIsChatSettingsOpen(false);
        data.goBack();
      }
    } catch {
      setError(chat.is_archived ? 'Failed to unarchive.' : 'Failed to archive.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handlePin = async () => {
    setIsUpdating(true);
    try {
      const updated = await patchChat(chat.id, { pinned: !chat.pinned });
      setChat(updated);
    } catch {
      setError('Failed to update pin status.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setIsUpdating(true);
    try {
      await deleteChat(chat.id);
      setIsChatSettingsOpen(false);
      navigate('/v2');
    } catch {
      setError('Failed to delete chat.');
      setIsUpdating(false);
    }
  };

  return (
    <Drawer open={isChatSettingsOpen} onOpenChange={handleOpen}>
      <DrawerContent className="max-h-[82dvh] overflow-y-auto pb-safe">
        <div className="space-y-4 p-4">
          <h3 className="text-sm font-semibold">Chat Settings</h3>

          {/* Title */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Title</label>
            <div className="flex gap-2">
              <Input
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                disabled={isUpdating}
                onKeyDown={(e) => { if (e.key === 'Enter') void saveTitle(); }}
              />
              <Button size="sm" disabled={isUpdating || !titleInput.trim() || titleInput.trim() === chat.title} onClick={() => void saveTitle()}>
                Save
              </Button>
            </div>
          </div>

          {/* Tags (read-only display) */}
          {chat.tags.length > 0 && (
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Tags</label>
              <div className="flex flex-wrap gap-1">
                {chat.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">{tag}</Badge>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" disabled={isUpdating} onClick={() => void handlePin()}>
              {chat.pinned ? <PinOff size={14} className="mr-1.5" /> : <Pin size={14} className="mr-1.5" />}
              {chat.pinned ? 'Unpin' : 'Pin'}
            </Button>
            <Button variant="outline" size="sm" disabled={isUpdating} onClick={() => void handleArchive()}>
              {chat.is_archived ? <ArchiveRestore size={14} className="mr-1.5" /> : <Archive size={14} className="mr-1.5" />}
              {chat.is_archived ? 'Unarchive' : 'Archive'}
            </Button>
          </div>

          {/* Delete */}
          <Button
            variant="destructive"
            size="sm"
            className="w-full"
            disabled={isUpdating}
            onClick={() => void handleDelete()}
          >
            <Trash2 size={14} className="mr-1.5" />
            {confirmDelete ? 'Confirm delete' : 'Delete chat'}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
