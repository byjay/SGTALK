import { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { ChatListPanel } from '../components/ChatListPanel';
import { ChatRoomView } from '../components/ChatRoomView';
import { ForwardModal } from '../components/chat/ForwardModal';
import {
  ImageLightboxModal,
  NewChatModal,
  NoticeModal,
  PollModal,
  ProfileModal,
} from '../components/Modals';
import { RightInspectorPanel } from '../components/RightInspectorPanel';
import { useDraftAutoSave } from '../hooks/useDraftAutoSave';
import { useGroupwareSocket, type SocketEvent } from '../hooks/useGroupwareSocket';
import { getRoomUnreadCount } from '../shared/logic';
import type {
  ChatRoom,
  InspectorTab,
  IntegrationActionSummary,
  LeaveRequest,
  LeaveType,
  Message,
  Notice,
  PollData,
  SedmsMenuKey,
  SharedFileItem,
  User,
  VoiceAttachment,
} from '../types/client';
import {
  buildIntegrationHostEvent,
  createRestChatAdapter,
  postSgwHostEvent,
  type SGWChatAdapter,
} from './adapter';

export interface SGWChatModuleProps {
  /** 현재 로그인한 SGW 사용자 */
  currentUser: User;
  /** Bearer 세션 인증 토큰 (메모리 보관용) */
  authToken?: string | null;
  /** 파일 미리보기/다운로드용 스코프 토큰 */
  fileToken?: string | null;
  /** 사내 전체 사용자 목록 (초기값; adapter.bootstrap 결과로 동기화 가능) */
  users?: User[];
  /** 커스텀 백엔드/Supabase/Firebase/REST 어댑터 (기본값: createRestChatAdapter()) */
  adapter?: SGWChatAdapter;
  /** 연차·알림 전체보기 탭으로 이동 콜백 (SGW_V0 호스트 연동) */
  onOpenHostLeave?: () => void;
  /** 자체 개발 메일앱 bmail 열기 콜백 */
  onOpenBmail?: (mailId?: string) => void;
  /** SEDMS 메뉴 열기 콜백 (전자결재, 문서관리, 프로젝트, 근태 등) */
  onOpenSedmsMenu?: (menuKey: SedmsMenuKey, payload?: Record<string, string>) => void;
  /** 프로젝트 달력 열기·일정 등록 콜백 */
  onOpenProjectCalendar?: (payload?: Record<string, string>) => void;
  /** SGW 미팅메모 열기·전송 콜백 */
  onOpenMeetingMemo?: (payload?: Record<string, string>) => void;
  /** SGW 회의 바로 시작/참여 콜백 */
  onStartOrJoinMeeting?: (payload?: Record<string, string>) => void;
  /** 대화로 연차 등록 완료 시 호스트 알림 콜백 */
  onLeaveRegistered?: (leave: LeaveRequest) => void;
  /** 읽지 않은 채팅 수 변경 시 호스트 뱃지 동기화 콜백 */
  onUnreadCountChange?: (count: number) => void;
  /** 컴팩트 사이드바/모바일 우선 레이아웃 여부 */
  compact?: boolean;
}

/**
 * SGW_V0 등 기존 그룹웨어의 채팅 기능만 교체할 때 바로 마운트할 수 있는
 * 독립형 엔터프라이즈 메신저 모듈(SEDMS × SGW 연동 브리지)입니다.
 */
export function SGWChatModule({
  currentUser: initialUser,
  authToken = null,
  fileToken = null,
  users: initialUsers = [],
  adapter: providedAdapter,
  onOpenHostLeave,
  onOpenBmail,
  onOpenSedmsMenu,
  onOpenProjectCalendar,
  onOpenMeetingMemo,
  onStartOrJoinMeeting,
  onLeaveRegistered,
  onUnreadCountChange,
  compact = false,
}: SGWChatModuleProps) {
  const adapter = useMemo(
    () => providedAdapter ?? createRestChatAdapter('', () => authToken),
    [providedAdapter, authToken],
  );
  const todayDate = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const [currentUser, setCurrentUser] = useState<User>(initialUser);
  const [users, setUsers] = useState<User[]>(initialUsers.length > 0 ? initialUsers : [initialUser]);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [files, setFiles] = useState<SharedFileItem[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('notices');
  const [typingByRoom, setTypingByRoom] = useState<Record<string, string[]>>({});
  const { draftsByRoom, lastSavedAtByRoom, setRoomDraft } = useDraftAutoSave();
  const [jumpRequest, setJumpRequest] = useState<{ messageId: string; nonce: number } | null>(null);
  const [forwardMessageIds, setForwardMessageIds] = useState<string[] | null>(null);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [noticeDraft, setNoticeDraft] = useState<{
    open: boolean;
    initialContent?: string;
    messageId?: string;
  }>({ open: false });
  const [showPollModal, setShowPollModal] = useState(false);
  const [lightboxFile, setLightboxFile] = useState<SharedFileItem | null>(null);
  const [profileUser, setProfileUser] = useState<User | null>(null);

  const reload = useCallback(async () => {
    const data = await adapter.bootstrap(initialUser.id);
    setCurrentUser(data.currentUser);
    setUsers(data.users);
    setRooms(data.rooms);
    setMessages(data.messages);
    setNotices(data.notices);
    setFiles(data.files);
    setLeaves(data.leaves);
    setActiveRoomId((prev) => prev ?? data.rooms[0]?.id ?? null);
    postSgwHostEvent({ type: 'SGW_CHAT_READY', version: '1.0' });
  }, [adapter, initialUser.id]);

  useEffect(() => {
    reload().catch(() => {});
  }, [reload]);

  const handleSocketEvent = useCallback((evt: SocketEvent) => {
    const p = evt.payload;
    if (evt.event === 'message:created') {
      const m = p.message as Message | undefined;
      const r = p.room as ChatRoom | undefined;
      if (m) setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      if (r) setRooms((prev) => prev.map((x) => (x.id === r.id ? r : x)));
    } else if (evt.event === 'message:updated') {
      const m = p.message as Message | undefined;
      if (m) setMessages((prev) => prev.map((x) => (x.id === m.id ? m : x)));
    } else if (evt.event === 'room:updated' || evt.event === 'room:created') {
      const r = p.room as ChatRoom | undefined;
      if (r) {
        setRooms((prev) =>
          prev.some((x) => x.id === r.id) ? prev.map((x) => (x.id === r.id ? r : x)) : [r, ...prev],
        );
      }
    } else if (evt.event === 'typing:update') {
      const roomId = String(p.roomId ?? '');
      const userId = String(p.userId ?? '');
      const isTyping = Boolean(p.isTyping);
      setTypingByRoom((prev) => {
        const list = prev[roomId] ?? [];
        const next = isTyping
          ? list.includes(userId)
            ? list
            : [...list, userId]
          : list.filter((id) => id !== userId);
        return { ...prev, [roomId]: next };
      });
    }
  }, []);

  const { sendTyping } = useGroupwareSocket(currentUser.id, authToken, handleSocketEvent);

  const usersById = useMemo(
    () => Object.fromEntries(users.map((u) => [u.id, u])),
    [users],
  );

  const totalUnread = useMemo(
    () =>
      rooms.reduce(
        (acc, r) => acc + getRoomUnreadCount(messages, r.id, currentUser.id),
        0,
      ),
    [rooms, messages, currentUser.id],
  );

  useEffect(() => {
    onUnreadCountChange?.(totalUnread);
    postSgwHostEvent({ type: 'SGW_UNREAD_CHANGED', count: totalUnread });
  }, [totalUnread, onUnreadCountChange]);

  const activeRoom = useMemo(
    () => rooms.find((r) => r.id === activeRoomId) ?? null,
    [rooms, activeRoomId],
  );

  const activeNotice = useMemo(() => {
    if (!activeRoom) return null;
    if (activeRoom.activeNoticeId) {
      const found = notices.find((n) => n.id === activeRoom.activeNoticeId);
      if (found) return found;
    }
    return notices.find((n) => n.roomId === activeRoom.id && n.pinned) ?? null;
  }, [activeRoom, notices]);

  const handleSelectRoom = (roomId: string) => {
    setActiveRoomId(roomId);
    setMobileChatOpen(true);
    adapter.markRead(roomId, currentUser.id).catch(() => {});
  };

  const handleStartDirectChat = async (targetUserId: string) => {
    const { room } = await adapter.openDirectRoom(currentUser.id, targetUserId);
    setRooms((prev) => (prev.some((r) => r.id === room.id) ? prev : [room, ...prev]));
    handleSelectRoom(room.id);
  };

  const handleTriggerIntegration = useCallback(
    async (
      summary: IntegrationActionSummary,
      options?: { recordInChat?: boolean },
    ) => {
      postSgwHostEvent(buildIntegrationHostEvent(summary));
      if (summary.menuKey === 'project-calendar') {
        onOpenProjectCalendar?.(summary.payload);
      } else if (summary.menuKey === 'meeting-memo') {
        onOpenMeetingMemo?.(summary.payload);
      } else if (summary.menuKey === 'meeting') {
        onStartOrJoinMeeting?.(summary.payload);
      } else if (summary.menuKey === 'bmail') {
        onOpenBmail?.(summary.payload?.mailId);
      } else {
        onOpenSedmsMenu?.(summary.menuKey, summary.payload);
      }

      if (options?.recordInChat !== false && activeRoom) {
        try {
          const res = await adapter.sendMessage({
            roomId: activeRoom.id,
            senderId: currentUser.id,
            type: 'integration_alert',
            content: `[${summary.system} 연동] ${summary.title}`,
            integrationAlert: summary,
          });
          if (res.message) {
            setMessages((prev) =>
              prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message],
            );
          }
        } catch {
          // Host bridge event already dispatched
        }
      }
    },
    [
      activeRoom,
      adapter,
      currentUser.id,
      onOpenBmail,
      onOpenMeetingMemo,
      onOpenProjectCalendar,
      onOpenSedmsMenu,
      onStartOrJoinMeeting,
    ],
  );

  return (
    <div className="h-full w-full flex bg-white dark:bg-neutral-900 overflow-hidden">
      <div
        className={`${
          compact
            ? mobileChatOpen
              ? 'hidden'
              : 'w-full'
            : mobileChatOpen
              ? 'hidden md:flex md:w-[330px] shrink-0'
              : 'w-full md:w-[330px] shrink-0'
        } h-full flex flex-col border-r border-neutral-200 dark:border-neutral-800`}
      >
        <ChatListPanel
          currentUser={currentUser}
          users={users}
          usersById={usersById}
          rooms={rooms}
          messages={messages}
          leaves={leaves}
          todayDate={todayDate}
          activeRoomId={activeRoomId}
          draftsByRoom={draftsByRoom}
          typingByRoom={typingByRoom}
          onSelectRoom={handleSelectRoom}
          onStartDirectChat={handleStartDirectChat}
          onOpenSelfChat={async () => {
            const { room } = await adapter.openSelfRoom(currentUser.id);
            setRooms((prev) => (prev.some((r) => r.id === room.id) ? prev : [room, ...prev]));
            handleSelectRoom(room.id);
          }}
          onOpenNewChatModal={() => setShowNewChatModal(true)}
          onTogglePinRoom={async (roomId) => {
            const { room } = await adapter.togglePinRoom(roomId, currentUser.id);
            setRooms((prev) => prev.map((r) => (r.id === room.id ? room : r)));
          }}
          onToggleMuteRoom={async (roomId) => {
            const { room } = await adapter.toggleMuteRoom(roomId, currentUser.id);
            setRooms((prev) => prev.map((r) => (r.id === room.id ? room : r)));
          }}
          onMarkRoomRead={(roomId) => {
            adapter.markRead(roomId, currentUser.id).catch(() => {});
          }}
          onLeaveRoom={async (roomId) => {
            await adapter.leaveRoom(roomId, currentUser.id);
            setRooms((prev) => prev.filter((r) => r.id !== roomId));
            if (activeRoomId === roomId) setActiveRoomId(null);
          }}
        />
      </div>

      <div
        className={`${
          mobileChatOpen ? 'flex-1 flex min-w-0' : 'hidden md:flex md:flex-1 md:min-w-0'
        } h-full`}
      >
        {activeRoom ? (
          <div className="flex-1 flex min-w-0 h-full min-h-0">
            <div className="flex-1 min-w-0 h-full min-h-0 flex flex-col">
              <ChatRoomView
                room={activeRoom}
                currentUser={currentUser}
                users={users}
                usersById={usersById}
                messages={messages.filter((m) => m.roomId === activeRoom.id)}
                activeNotice={activeNotice}
                typingUserIds={typingByRoom[activeRoom.id] ?? []}
                todayDate={todayDate}
                draftText={draftsByRoom[activeRoom.id] ?? ''}
                draftSavedAt={lastSavedAtByRoom[activeRoom.id] ?? null}
                fileToken={fileToken}
                jumpToMessageRequest={jumpRequest}
                showBackButton={compact || mobileChatOpen}
                showInspectorToggle
                onBack={() => setMobileChatOpen(false)}
                onToggleInspector={() => setShowInspector((v) => !v)}
                onDraftChange={(val) => setRoomDraft(activeRoom.id, val)}
                onOpenNoticeModal={(initialContent, messageId) =>
                  setNoticeDraft({ open: true, initialContent, messageId })
                }
                onOpenPollModal={() => setShowPollModal(true)}
                onSendMessage={async (payload: {
                  type: Message['type'];
                  content: string;
                  replyToId?: string | null;
                  emoticonId?: string;
                  poll?: PollData;
                  voice?: VoiceAttachment;
                }) => {
                  const res = await adapter.sendMessage({
                    roomId: activeRoom.id,
                    senderId: currentUser.id,
                    ...payload,
                  });
                  if (res.message) {
                    setMessages((prev) =>
                      prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message],
                    );
                  }
                }}
                onUploadFile={async (file, caption) => {
                  const uploaded = await adapter.uploadFile(file, {
                    roomId: activeRoom.id,
                    uploaderId: currentUser.id,
                    caption,
                  });
                  setFiles((prev) =>
                    prev.some((f) => f.id === uploaded.id) ? prev : [uploaded, ...prev],
                  );
                  if (uploaded._serverMessage) {
                    const srvMsg = uploaded._serverMessage;
                    setMessages((prev) =>
                      prev.some((m) => m.id === srvMsg.id) ? prev : [...prev, srvMsg],
                    );
                  } else {
                    const res = await adapter.sendMessage({
                      roomId: activeRoom.id,
                      senderId: currentUser.id,
                      type: uploaded.isImage ? 'image' : 'file',
                      content: caption?.trim() || uploaded.filename,
                      file: uploaded,
                    });
                    if (res.message) {
                      setMessages((prev) =>
                        prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message],
                      );
                    }
                  }
                }}
                onToggleReaction={async (messageId, emoji) => {
                  const { message } = await adapter.toggleReaction(messageId, currentUser.id, emoji);
                  setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
                }}
                onToggleStarMessage={async (messageId) => {
                  const { message } = await adapter.toggleStar(messageId, currentUser.id);
                  setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
                }}
                onEditMessage={async (messageId, content) => {
                  const { message } = await adapter.editMessage(messageId, currentUser.id, content);
                  setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
                }}
                onRecallMessage={async (messageId) => {
                  const { message } = await adapter.recallMessage(messageId, currentUser.id);
                  setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
                }}
                onDeleteMessage={async (messageId) => {
                  const { message } = await adapter.deleteMessage(messageId, currentUser.id);
                  setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
                }}
                onOpenForwardModal={(ids) => setForwardMessageIds(ids)}
                onVotePoll={async (messageId, optionId) => {
                  const { message } = await adapter.votePoll(messageId, currentUser.id, optionId);
                  setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
                }}
                onRegisterLeaveFromChat={async (input: {
                  type: LeaveType;
                  startDate: string;
                  endDate: string;
                  substituteId: string | null;
                  reason: string;
                }) => {
                  try {
                    const res = await adapter.registerLeaveFromChat({
                      userId: currentUser.id,
                      ...input,
                      roomId: activeRoom.id,
                    });
                    if (res.leave) {
                      setLeaves((prev) => [res.leave, ...prev]);
                      onLeaveRegistered?.(res.leave);
                      postSgwHostEvent({
                        type: 'SGW_LEAVE_REGISTERED',
                        leaveId: res.leave.id,
                        summary: `${input.type} (${input.startDate})`,
                      });
                    }
                    return { ok: true };
                  } catch (err) {
                    return { ok: false, error: err instanceof Error ? err.message : '연차 등록 실패' };
                  }
                }}
                onTriggerIntegration={handleTriggerIntegration}
                onTypingChange={(isTyping) => sendTyping(activeRoom.id, isTyping)}
                onMarkRead={() => {
                  adapter.markRead(activeRoom.id, currentUser.id).catch(() => {});
                }}
                onStartDirectChat={handleStartDirectChat}
                onPreviewImage={setLightboxFile}
                onSelectUserProfile={setProfileUser}
                onGoToLeaveTab={() => {
                  onOpenHostLeave?.();
                }}
                onGoToMailTab={() => {
                  onOpenBmail?.();
                  postSgwHostEvent({ type: 'BMAIL_OPEN' });
                }}
              />
            </div>

            {showInspector && (
              <div className="w-[300px] shrink-0 hidden lg:block h-full">
                <RightInspectorPanel
                  room={activeRoom}
                  currentUser={currentUser}
                  users={users}
                  usersById={usersById}
                  messages={messages}
                  notices={notices}
                  files={files}
                  leaves={leaves}
                  todayDate={todayDate}
                  activeTab={inspectorTab}
                  onChangeTab={setInspectorTab}
                  onClose={() => setShowInspector(false)}
                  onOpenCreateNotice={() => setNoticeDraft({ open: true })}
                  onTogglePinRoom={async () => {
                    const { room } = await adapter.togglePinRoom(activeRoom.id, currentUser.id);
                    setRooms((prev) => prev.map((r) => (r.id === room.id ? room : r)));
                  }}
                  onToggleMuteRoom={async () => {
                    const { room } = await adapter.toggleMuteRoom(activeRoom.id, currentUser.id);
                    setRooms((prev) => prev.map((r) => (r.id === room.id ? room : r)));
                  }}
                  onSetDisappearing={async (seconds) => {
                    const { room, message } = await adapter.setDisappearing(
                      activeRoom.id,
                      currentUser.id,
                      seconds,
                    );
                    setRooms((prev) => prev.map((r) => (r.id === room.id ? room : r)));
                    if (message) setMessages((prev) => [...prev, message]);
                  }}
                  onLeaveRoom={async () => {
                    await adapter.leaveRoom(activeRoom.id, currentUser.id);
                    setRooms((prev) => prev.filter((r) => r.id !== activeRoom.id));
                    setActiveRoomId(null);
                  }}
                  onInviteMembers={async (userIds) => {
                    const { room } = await adapter.inviteMembers(
                      activeRoom.id,
                      currentUser.id,
                      userIds,
                    );
                    setRooms((prev) => prev.map((r) => (r.id === room.id ? room : r)));
                  }}
                  onJumpToMessage={(messageId) =>
                    setJumpRequest({ messageId, nonce: Date.now() })
                  }
                  onToggleStarMessage={async (messageId) => {
                    const { message } = await adapter.toggleStar(messageId, currentUser.id);
                    setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
                  }}
                  onPreviewImage={setLightboxFile}
                  onSelectUserProfile={setProfileUser}
                  fileToken={fileToken}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-neutral-400">
            <MessageCircle className="h-10 w-10 text-[#07C160]" />
            <p className="text-sm font-medium">채팅방을 선택하거나 새 대화를 시작하세요</p>
          </div>
        )}
      </div>

      {showNewChatModal && (
        <NewChatModal
          currentUser={currentUser}
          users={users}
          onClose={() => setShowNewChatModal(false)}
          onCreateRoom={async (memberIds, name) => {
            const { room } = await adapter.createRoom({
              creatorId: currentUser.id,
              memberIds,
              name,
              type: memberIds.length > 1 ? 'group' : 'direct',
            });
            setRooms((prev) => [room, ...prev]);
            handleSelectRoom(room.id);
          }}
        />
      )}

      {noticeDraft.open && activeRoom && (
        <NoticeModal
          initialContent={noticeDraft.initialContent}
          onClose={() => setNoticeDraft({ open: false })}
          onSubmit={async (title, content) => {
            const res = await adapter.createNotice(activeRoom.id, currentUser.id, title, content);
            if (res.notice) setNotices((prev) => [res.notice, ...prev]);
          }}
        />
      )}

      {showPollModal && activeRoom && (
        <PollModal
          onClose={() => setShowPollModal(false)}
          onSubmit={async (poll) => {
            const res = await adapter.sendMessage({
              roomId: activeRoom.id,
              senderId: currentUser.id,
              type: 'poll',
              content: poll.question,
              poll,
            });
            if (res.message) setMessages((prev) => [...prev, res.message]);
          }}
        />
      )}

      {forwardMessageIds && forwardMessageIds.length > 0 && (
        <ForwardModal
          messageCount={forwardMessageIds.length}
          currentUser={currentUser}
          users={users}
          usersById={usersById}
          rooms={rooms}
          currentRoomId={activeRoomId ?? ''}
          onClose={() => setForwardMessageIds(null)}
          onForward={async (target) => {
            const res = await adapter.forwardMessages({
              senderId: currentUser.id,
              messageIds: forwardMessageIds,
              ...target,
            });
            setRooms((prev) =>
              prev.some((r) => r.id === res.room.id)
                ? prev.map((r) => (r.id === res.room.id ? res.room : r))
                : [res.room, ...prev],
            );
            handleSelectRoom(res.room.id);
          }}
        />
      )}

      {profileUser && (
        <ProfileModal
          user={profileUser}
          isMe={profileUser.id === currentUser.id}
          onClose={() => setProfileUser(null)}
          onStartDirectChat={handleStartDirectChat}
          onSaveStatusMessage={async () => {}}
        />
      )}

      {lightboxFile && (
        <ImageLightboxModal
          file={lightboxFile}
          fileToken={fileToken}
          onClose={() => setLightboxFile(null)}
        />
      )}
    </div>
  );
}
