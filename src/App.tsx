import React, { useState, useEffect, useRef } from 'react';
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  updateDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  addDoc, 
  serverTimestamp, 
  Timestamp 
} from 'firebase/firestore';
import { signInAnonymously, onAuthStateChanged, User } from 'firebase/auth';
import { 
  MessageSquare, 
  PlusCircle, 
  LogIn, 
  Send, 
  Copy, 
  Trash2, 
  Moon, 
  Sun, 
  User as UserIcon,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { db, auth, handleFirestoreError, OperationType } from './firebase';

// --- Types ---

interface Message {
  id: string;
  text: string;
  userId: string;
  timestamp: Timestamp | null;
}

interface RoomData {
  name: string;
  passwordHash: string;
  users: string[];
  finishStatus: Record<string, boolean>;
  lastActivity: Timestamp;
  typing: Record<string, boolean>;
}

// --- Components ---

const ErrorBoundary = ({ children }: { children: React.ReactNode }) => {
  const [hasError, setHasError] = useState(false);
  const [errorInfo, setErrorInfo] = useState<any>(null);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      try {
        const parsed = JSON.parse(event.error.message);
        if (parsed.error) {
          setHasError(true);
          setErrorInfo(parsed);
        }
      } catch (e) {
        // Not a FirestoreErrorInfo JSON
      }
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-red-900/20">
        <div className="glass p-8 max-w-md w-full text-white space-y-4">
          <h2 className="text-2xl font-bold text-red-400">Application Error</h2>
          <p className="text-white/70">A critical error occurred while interacting with the database.</p>
          <div className="bg-black/30 p-4 rounded-lg text-xs font-mono overflow-auto max-h-40">
            {JSON.stringify(errorInfo, null, 2)}
          </div>
          <button 
            onClick={() => window.location.reload()}
            className="w-full py-2 bg-red-600 hover:bg-red-500 rounded-lg font-bold transition-all"
          >
            Reload Application
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default function App() {
  const [guestId] = useState(() => {
    const saved = localStorage.getItem('glasschat_uid');
    if (saved) return saved;
    const newId = 'guest_' + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('glasschat_uid', newId);
    return newId;
  });
  const [isAuthReady, setIsAuthReady] = useState(true); // Always ready in Guest Mode
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [roomData, setRoomData] = useState<RoomData | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'info' | 'error' } | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Form states
  const [createRoomId, setCreateRoomId] = useState('');
  const [createRoomPass, setCreateRoomPass] = useState('');
  const [joinRoomId, setJoinRoomId] = useState('');
  const [joinRoomPass, setJoinRoomPass] = useState('');
  const [messageInput, setMessageInput] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // --- Initialization ---

  // Removed onAuthStateChanged for Guest Mode

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // --- Utility Functions ---

  const showToast = (message: string, type: 'info' | 'error' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const hashPassword = async (password: string) => {
    const msgUint8 = new TextEncoder().encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  // --- Room Actions ---

  const handleCreateRoom = async () => {
    if (!createRoomId || !createRoomPass) {
      showToast("Please enter room name and password", "error");
      return;
    }

    setIsLoading(true);
    try {
      const roomId = createRoomId.trim();
      const roomRef = doc(db, "rooms", roomId);
      
      let roomSnap;
      try {
        roomSnap = await getDoc(roomRef);
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `rooms/${roomId}`);
        return;
      }

      if (roomSnap.exists()) {
        showToast("Room already exists. Try a different name.", "error");
        setIsLoading(false);
        return;
      }

      const passwordHash = await hashPassword(createRoomPass);
      try {
        await setDoc(roomRef, {
          name: roomId,
          passwordHash: passwordHash,
          users: [guestId],
          finishStatus: { [guestId]: false },
          lastActivity: serverTimestamp(),
          typing: { [guestId]: false }
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `rooms/${roomId}`);
        return;
      }

      setActiveRoomId(roomId);
      showToast(`Room "${roomId}" created!`);
    } catch (err) {
      console.error("Create room error:", err);
      showToast("Error creating room", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinRoom = async () => {
    if (!joinRoomId || !joinRoomPass) {
      showToast("Please enter room name and password", "error");
      return;
    }

    setIsLoading(true);
    try {
      const roomId = joinRoomId.trim();
      const roomRef = doc(db, "rooms", roomId);
      
      let roomSnap;
      try {
        roomSnap = await getDoc(roomRef);
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `rooms/${roomId}`);
        return;
      }

      if (!roomSnap.exists()) {
        showToast("Room not found", "error");
        setIsLoading(false);
        return;
      }

      const data = roomSnap.data() as RoomData;
      
      // Check inactivity (2 minutes)
      const lastActivity = data.lastActivity?.toDate();
      if (lastActivity && (new Date().getTime() - lastActivity.getTime() > 120000)) {
        try {
          await deleteDoc(roomRef);
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `rooms/${roomId}`);
        }
        showToast("Room expired due to inactivity", "error");
        setIsLoading(false);
        return;
      }

      const passwordHash = await hashPassword(joinRoomPass);
      if (data.passwordHash !== passwordHash) {
        showToast("Incorrect password", "error");
        setIsLoading(false);
        return;
      }

      // Update room data
      const updatedUsers = Array.from(new Set([...(data.users || []), guestId]));
      const updatedFinishStatus = { ...(data.finishStatus || {}), [guestId]: false };
      const updatedTyping = { ...(data.typing || {}), [guestId]: false };

      try {
        await updateDoc(roomRef, {
          users: updatedUsers,
          finishStatus: updatedFinishStatus,
          typing: updatedTyping,
          lastActivity: serverTimestamp()
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `rooms/${roomId}`);
      }

      setActiveRoomId(roomId);
      showToast(`Joined room: ${roomId}`);
    } catch (err) {
      console.error("Join room error:", err);
      showToast("Error joining room", "error");
    } finally {
      setIsLoading(false);
    }
  };

  // --- Chat Listeners ---

  useEffect(() => {
    if (!activeRoomId) return;

    const messagesRef = collection(db, "rooms", activeRoomId, "messages");
    const q = query(messagesRef, orderBy("timestamp", "asc"));
    
    const unsubscribeMessages = onSnapshot(q, (snapshot) => {
      const msgs: Message[] = [];
      snapshot.forEach((doc) => {
        msgs.push({ id: doc.id, ...doc.data() } as Message);
      });
      setMessages(msgs);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, `rooms/${activeRoomId}/messages`);
    });

    const roomRef = doc(db, "rooms", activeRoomId);
    const unsubscribeRoom = onSnapshot(roomRef, async (docSnap) => {
      if (!docSnap.exists()) {
        setActiveRoomId(null);
        setRoomData(null);
        setMessages([]);
        showToast("Room has been deleted", "info");
        return;
      }

      const data = docSnap.data() as RoomData;
      setRoomData(data);

      // Check finish status
      const allFinished = data.users.length > 0 && data.users.every(uid => data.finishStatus[uid] === true);
      if (allFinished) {
        try {
          await deleteDoc(roomRef);
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `rooms/${activeRoomId}`);
        }
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, `rooms/${activeRoomId}`);
    });

    return () => {
      unsubscribeMessages();
      unsubscribeRoom();
    };
  }, [activeRoomId]);

  // --- Chat Actions ---

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim() || !activeRoomId) return;

    const text = messageInput.trim();
    setMessageInput('');

    try {
      const messagesRef = collection(db, "rooms", activeRoomId, "messages");
      await addDoc(messagesRef, {
        text,
        userId: guestId,
        timestamp: serverTimestamp()
      });

      const roomRef = doc(db, "rooms", activeRoomId);
      await updateDoc(roomRef, {
        lastActivity: serverTimestamp()
      });

      updateTypingStatus(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `rooms/${activeRoomId}/messages`);
    }
  };

  const updateTypingStatus = async (typing: boolean) => {
    if (!activeRoomId) return;
    try {
      const roomRef = doc(db, "rooms", activeRoomId);
      await updateDoc(roomRef, {
        [`typing.${guestId}`]: typing
      });
    } catch (err) {
      // Silently fail for typing status
    }
  };

  const handleTyping = () => {
    if (!isTyping) {
      setIsTyping(true);
      updateTypingStatus(true);
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
      updateTypingStatus(false);
    }, 2000);
  };

  const handleFinishChat = async () => {
    if (!activeRoomId) return;
    try {
      const roomRef = doc(db, "rooms", activeRoomId);
      await updateDoc(roomRef, {
        [`finishStatus.${guestId}`]: true,
        lastActivity: serverTimestamp()
      });
      showToast("Waiting for others to finish...");
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `rooms/${activeRoomId}`);
    }
  };

  // --- Render Helpers ---

  const renderLanding = () => (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex-1 p-6 flex flex-col justify-center gap-8"
    >
      {/* Create Room */}
      <div className="space-y-4">
        <h2 className="text-white font-semibold text-xl flex items-center gap-2">
          <PlusCircle className="w-5 h-5 text-indigo-400" />
          Create a Room
        </h2>
        <div className="grid gap-3">
          <input 
            type="text" 
            placeholder="Room Name (e.g. SecretMeeting)" 
            value={createRoomId}
            onChange={(e) => setCreateRoomId(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
          />
          <input 
            type="password" 
            placeholder="Password" 
            value={createRoomPass}
            onChange={(e) => setCreateRoomPass(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
          />
          <button 
            onClick={handleCreateRoom}
            disabled={isLoading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl shadow-lg shadow-indigo-500/20 transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Create & Join"}
          </button>
        </div>
      </div>

      <div className="relative">
        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10"></div></div>
        <div className="relative flex justify-center text-xs uppercase"><span className="bg-indigo-900/20 px-2 text-white/30">OR</span></div>
      </div>

      {/* Join Room */}
      <div className="space-y-4">
        <h2 className="text-white font-semibold text-xl flex items-center gap-2">
          <LogIn className="w-5 h-5 text-indigo-400" />
          Join a Room
        </h2>
        <div className="grid gap-3">
          <input 
            type="text" 
            placeholder="Room Name" 
            value={joinRoomId}
            onChange={(e) => setJoinRoomId(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
          />
          <input 
            type="password" 
            placeholder="Password" 
            value={joinRoomPass}
            onChange={(e) => setJoinRoomPass(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
          />
          <button 
            onClick={handleJoinRoom}
            disabled={isLoading}
            className="w-full bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white font-bold py-3 rounded-xl border border-white/10 transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Join Room"}
          </button>
        </div>
      </div>
    </motion.div>
  );

  const renderChat = () => {
    const typingUsers = roomData ? Object.keys(roomData.typing || {}).filter(uid => uid !== guestId && roomData.typing[uid]) : [];

    return (
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex-1 flex flex-col overflow-hidden"
      >
        {/* Chat Info Bar */}
        <div className="px-4 py-2 bg-white/5 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-white font-medium">{activeRoomId}</span>
            <button 
              onClick={() => {
                if (activeRoomId) {
                  navigator.clipboard.writeText(activeRoomId);
                  showToast("Room ID copied!");
                }
              }}
              className="p-1.5 text-white/50 hover:text-white transition-all"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
          <button 
            onClick={handleFinishChat}
            className="text-xs font-bold px-3 py-1.5 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-lg transition-all flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Finish Chat
          </button>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2 custom-scrollbar">
          {messages.map((msg) => {
            const isMe = msg.userId === guestId;
            return (
              <div 
                key={msg.id} 
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
              >
                <div className={`max-w-[80%] p-3 rounded-2xl ${isMe ? 'bg-indigo-600/40 text-white rounded-br-none' : 'bg-white/10 text-white rounded-bl-none'}`}>
                  <p className="text-sm break-words">{msg.text}</p>
                  <span className="text-[10px] text-white/40 mt-1 block text-right">
                    {msg.timestamp ? new Date(msg.timestamp.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '...'}
                  </span>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Typing Indicator */}
        <div className="px-4 py-1 h-6 text-xs italic text-white/50">
          {typingUsers.length > 0 && "Someone is typing..."}
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-white/10 bg-white/5">
          <form onSubmit={handleSendMessage} className="flex gap-2">
            <input 
              type="text" 
              placeholder="Type a message..." 
              value={messageInput}
              onChange={(e) => {
                setMessageInput(e.target.value);
                handleTyping();
              }}
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
            />
            <button 
              type="submit"
              className="p-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl shadow-lg shadow-indigo-500/20 transition-all active:scale-95"
            >
              <Send className="w-6 h-6" />
            </button>
          </form>
        </div>
      </motion.div>
    );
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen p-4 md:p-8 flex items-center justify-center">
        <div className="w-full max-w-2xl glass shadow-2xl overflow-hidden flex flex-col h-[85vh]">
          
          {/* Header */}
          <div className="p-4 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-500/20 rounded-lg">
                <MessageSquare className="text-indigo-400 w-6 h-6" />
              </div>
              <div>
                <h1 className="text-white font-bold text-lg leading-none">GlassChat</h1>
                <span className="text-white/50 text-xs">Secure Anonymous Chat</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setIsDarkMode(!isDarkMode)}
                className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-all"
              >
                {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>
              {activeRoomId && (
                <div className="flex items-center gap-1.5 px-3 py-1 bg-green-500/20 text-green-400 rounded-full text-xs font-medium">
                  <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                  <span>{roomData?.users?.length || 0}</span> Online
                </div>
              )}
            </div>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {!isAuthReady ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
              </div>
            ) : (
              activeRoomId ? renderChat() : renderLanding()
            )}
          </div>
        </div>

        {/* Toast Notification */}
        <AnimatePresence>
          {toast && (
            <motion.div 
              initial={{ opacity: 0, y: 20, x: '-50%' }}
              animate={{ opacity: 1, y: 0, x: '-50%' }}
              exit={{ opacity: 0, y: 20, x: '-50%' }}
              className={`fixed bottom-8 left-1/2 px-6 py-3 glass text-white text-sm font-medium shadow-2xl z-50 ${toast.type === 'error' ? 'border-red-500/50' : 'border-white/20'}`}
            >
              {toast.message}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ErrorBoundary>
  );
}
