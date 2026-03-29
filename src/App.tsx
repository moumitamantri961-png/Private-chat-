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
  Timestamp,
  where,
  getDocs,
  limit,
  writeBatch,
  arrayUnion,
  arrayRemove,
  deleteField
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  onAuthStateChanged, 
  User as FirebaseUser,
  signOut
} from 'firebase/auth';
import { 
  ref, 
  uploadBytes, 
  getDownloadURL 
} from 'firebase/storage';
import { 
  MessageSquare, 
  PlusCircle, 
  Send, 
  Copy, 
  Trash2, 
  User as UserIcon,
  Loader2,
  Search,
  LogOut,
  MoreVertical,
  X,
  Users,
  Hash,
  ArrowLeft,
  Check,
  CheckCheck,
  Camera,
  Settings,
  Shield,
  Terminal,
  Cpu,
  Activity,
  UserPlus,
  UserMinus
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { db, auth, storage, googleProvider } from './firebase';

// --- Types ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface UserProfile {
  uid: string;
  username: string;
  displayName: string;
  photoURL: string;
  email: string;
  createdAt: Timestamp;
  lastSeen?: Timestamp;
}

interface Chat {
  id: string;
  type: 'dm' | 'group';
  participants: string[];
  name?: string;
  lastMessage?: string;
  updatedAt: Timestamp;
  createdBy?: string;
  otherUser?: UserProfile; // For DMs
  lastRead?: Record<string, Timestamp>;
  unreadCount?: number;
  typing?: Record<string, Timestamp>;
}

interface Message {
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  timestamp: Timestamp | null;
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
      <div className="min-h-screen flex items-center justify-center p-4 bg-black">
        <div className="glass p-8 max-w-md w-full text-white space-y-4 border-red-500/50">
          <div className="flex items-center gap-2 text-red-400">
            <Activity className="w-6 h-6" />
            <h2 className="text-2xl font-mono font-bold uppercase tracking-tighter">System Failure</h2>
          </div>
          <p className="text-white/70 font-mono text-sm">Critical database synchronization error detected.</p>
          <div className="bg-black/50 p-4 rounded border border-red-500/20 text-[10px] font-mono overflow-auto max-h-40 text-red-300">
            {JSON.stringify(errorInfo, null, 2)}
          </div>
          <button 
            onClick={() => window.location.reload()}
            className="w-full py-2 bg-red-900/40 hover:bg-red-800/60 border border-red-500/50 text-red-400 font-mono text-sm transition-all uppercase tracking-widest"
          >
            Reboot System
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [toast, setToast] = useState<{ message: string; type: 'info' | 'error' } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  // UI States
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [showGroupCreate, setShowGroupCreate] = useState(false);
  const [showManageGroup, setShowManageGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [messageInput, setMessageInput] = useState('');
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [groupMembers, setGroupMembers] = useState<UserProfile[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // --- Initialization ---

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u) {
        setUser(u);
        const profileSnap = await getDoc(doc(db, "users", u.uid));
        if (profileSnap.exists()) {
          const profileData = profileSnap.data() as UserProfile;
          setProfile(profileData);
          
          await updateDoc(doc(db, "users", u.uid), {
            lastSeen: serverTimestamp()
          });
        }
      } else {
        setUser(null);
        setProfile(null);
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!profile) return;
    const interval = setInterval(async () => {
      try {
        await updateDoc(doc(db, "users", profile.uid), {
          lastSeen: serverTimestamp()
        });
      } catch (err) {
        console.error("Failed to update lastSeen:", err);
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [profile]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // --- Listeners ---

  useEffect(() => {
    if (!profile) return;

    const chatsRef = collection(db, "chats");
    const q = query(
      chatsRef, 
      where("participants", "array-contains", profile.uid),
      orderBy("updatedAt", "desc")
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const chatList: Chat[] = [];
      for (const d of snapshot.docs) {
        const chatData = d.data() as Chat;
        chatData.id = d.id;
        
        if (chatData.type === 'dm') {
          const otherId = chatData.participants.find(id => id !== profile.uid);
          if (otherId) {
            const otherSnap = await getDoc(doc(db, "users", otherId));
            if (otherSnap.exists()) {
              chatData.otherUser = otherSnap.data() as UserProfile;
            }
          }
        }

        const lastRead = chatData.lastRead?.[profile.uid];
        if (lastRead) {
          const messagesRef = collection(db, "chats", d.id, "messages");
          const unreadQ = query(messagesRef, where("timestamp", ">", lastRead));
          const unreadSnap = await getDocs(unreadQ);
          chatData.unreadCount = unreadSnap.size;
        } else {
          const messagesRef = collection(db, "chats", d.id, "messages");
          const allMessagesSnap = await getDocs(messagesRef);
          chatData.unreadCount = allMessagesSnap.size;
        }

        chatList.push(chatData);
      }
      setChats(chatList);
    });

    return () => unsubscribe();
  }, [profile]);

  useEffect(() => {
    if (!profile || !activeChatId) return;

    const updateLastRead = async () => {
      try {
        const chatRef = doc(db, "chats", activeChatId);
        await updateDoc(chatRef, {
          [`lastRead.${profile.uid}`]: serverTimestamp()
        });
      } catch (err) {
        console.error("Failed to update lastRead:", err);
      }
    };

    updateLastRead();
    
    const messagesRef = collection(db, "chats", activeChatId, "messages");
    const q = query(messagesRef, orderBy("timestamp", "desc"), limit(1));
    const unsubscribe = onSnapshot(q, (snap) => {
      if (!snap.empty) {
        updateLastRead();
      }
    });

    return () => unsubscribe();
  }, [profile, activeChatId]);

  useEffect(() => {
    if (!activeChatId) {
      setMessages([]);
      setTypingUsers([]);
      return;
    }

    const messagesRef = collection(db, "chats", activeChatId, "messages");
    const q = query(messagesRef, orderBy("timestamp", "asc"));

    const unsubscribeMessages = onSnapshot(q, (snapshot) => {
      const msgs: Message[] = [];
      snapshot.forEach((d) => {
        msgs.push({ id: d.id, ...d.data() } as Message);
      });
      setMessages(msgs);
    });

    const chatRef = doc(db, "chats", activeChatId);
    const unsubscribeChat = onSnapshot(chatRef, async (snapshot) => {
      if (snapshot.exists()) {
        const chatData = snapshot.data() as Chat;
        const typing = chatData.typing || {};
        const now = Date.now();
        const typingList: string[] = [];
        
        for (const [uid, timestamp] of Object.entries(typing)) {
          if (uid !== profile?.uid && (now - (timestamp as Timestamp).toMillis()) < 5000) {
            const userSnap = await getDoc(doc(db, "users", uid));
            if (userSnap.exists()) {
              typingList.push((userSnap.data() as UserProfile).displayName);
            }
          }
        }
        setTypingUsers(typingList);

        if (showManageGroup && chatData.type === 'group') {
          const members: UserProfile[] = [];
          for (const uid of chatData.participants) {
            const userSnap = await getDoc(doc(db, "users", uid));
            if (userSnap.exists()) {
              members.push(userSnap.data() as UserProfile);
            }
          }
          setGroupMembers(members);
        }
      }
    });

    return () => {
      unsubscribeMessages();
      unsubscribeChat();
    };
  }, [activeChatId, profile, showManageGroup]);

  // --- Actions ---

  const showToast = (message: string, type: 'info' | 'error' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleGoogleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error("Login error:", err);
      showToast("Failed to login with Google", "error");
    }
  };

  const handleSetUsername = async () => {
    if (!user || !usernameInput.trim() || usernameInput.length < 3) {
      showToast("Username must be at least 3 characters", "error");
      return;
    }

    const username = usernameInput.trim().toLowerCase();
    setIsLoading(true);

    try {
      const usernameRef = doc(db, "usernames", username);
      const usernameSnap = await getDoc(usernameRef);

      if (usernameSnap.exists()) {
        showToast("Username already taken", "error");
        setIsLoading(false);
        return;
      }

      const batch = writeBatch(db);
      const userRef = doc(db, "users", user.uid);
      const profileData: UserProfile = {
        uid: user.uid,
        username,
        displayName: user.displayName || username,
        photoURL: user.photoURL || '',
        email: user.email || '',
        createdAt: serverTimestamp() as Timestamp
      };

      batch.set(userRef, profileData);
      batch.set(usernameRef, { uid: user.uid });
      
      await batch.commit();
      setProfile(profileData);
      showToast("Welcome to GlassChat!");
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleProfileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;

    setIsLoading(true);
    try {
      const storageRef = ref(storage, `profiles/${profile.uid}`);
      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);
      
      await updateDoc(doc(db, "users", profile.uid), {
        photoURL: downloadURL
      });
      
      setProfile({ ...profile, photoURL: downloadURL });
      showToast("Profile picture updated");
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${profile.uid}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsLoading(true);
    try {
      const q = query(
        collection(db, "users"), 
        where("username", "==", searchQuery.trim().toLowerCase()),
        limit(1)
      );
      const snap = await getDocs(q);
      const results: UserProfile[] = [];
      snap.forEach(d => results.push(d.data() as UserProfile));
      setSearchResults(results);
      if (results.length === 0) showToast("No user found", "info");
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, "users");
    } finally {
      setIsLoading(false);
    }
  };

  const startDM = async (otherUser: UserProfile) => {
    if (!profile) return;
    const existing = chats.find(c => c.type === 'dm' && c.participants.includes(otherUser.uid));
    if (existing) {
      setActiveChatId(existing.id);
      setShowSearch(false);
      return;
    }
    try {
      const chatId = [profile.uid, otherUser.uid].sort().join('_');
      const chatRef = doc(db, "chats", chatId);
      await setDoc(chatRef, {
        type: 'dm',
        participants: [profile.uid, otherUser.uid],
        createdBy: profile.uid,
        updatedAt: serverTimestamp()
      });
      setActiveChatId(chatId);
      setShowSearch(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `chats/${[profile.uid, otherUser.uid].sort().join('_')}`);
    }
  };

  const createGroup = async () => {
    if (!profile || !groupName.trim()) return;
    try {
      const chatRef = doc(collection(db, "chats"));
      await setDoc(chatRef, {
        type: 'group',
        name: groupName.trim(),
        participants: [profile.uid],
        createdBy: profile.uid,
        updatedAt: serverTimestamp()
      });
      setActiveChatId(chatRef.id);
      setShowGroupCreate(false);
      setGroupName('');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, "chats");
    }
  };

  const handleTyping = async () => {
    if (!profile || !activeChatId) return;
    try {
      await updateDoc(doc(db, "chats", activeChatId), {
        [`typing.${profile.uid}`]: serverTimestamp()
      });
    } catch (err) {
      console.error("Typing error:", err);
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim() || !activeChatId || !profile) return;

    const text = messageInput.trim();
    setMessageInput('');

    try {
      const chatRef = doc(db, "chats", activeChatId);
      const messagesRef = collection(chatRef, "messages");
      
      await addDoc(messagesRef, {
        text,
        senderId: profile.uid,
        senderName: profile.displayName,
        timestamp: serverTimestamp()
      });

      await updateDoc(chatRef, {
        lastMessage: text,
        updatedAt: serverTimestamp(),
        [`typing.${profile.uid}`]: deleteField() // Clear typing status
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `chats/${activeChatId}/messages`);
    }
  };

  const addMember = async (userToAdd: UserProfile) => {
    if (!activeChatId || !profile) return;
    try {
      await updateDoc(doc(db, "chats", activeChatId), {
        participants: arrayUnion(userToAdd.uid)
      });
      showToast(`Added ${userToAdd.displayName}`);
      setSearchQuery('');
      setSearchResults([]);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `chats/${activeChatId}`);
    }
  };

  const removeMember = async (uidToRemove: string) => {
    if (!activeChatId || !profile) return;
    if (uidToRemove === profile.uid) return;
    try {
      await updateDoc(doc(db, "chats", activeChatId), {
        participants: arrayRemove(uidToRemove)
      });
      showToast("Member removed");
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `chats/${activeChatId}`);
    }
  };

  const clearChat = async () => {
    if (!activeChatId) return;
    if (!confirm("Clear all messages in this chat?")) return;
    try {
      const messagesRef = collection(db, "chats", activeChatId, "messages");
      const snap = await getDocs(messagesRef);
      const batch = writeBatch(db);
      snap.forEach(d => batch.delete(d.ref));
      await batch.commit();
      await updateDoc(doc(db, "chats", activeChatId), { lastMessage: "Messages cleared" });
      showToast("Chat cleared");
      setShowChatMenu(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `chats/${activeChatId}/messages`);
    }
  };

  const deleteChat = async () => {
    if (!activeChatId) return;
    if (!confirm("Delete this conversation?")) return;
    try {
      await deleteDoc(doc(db, "chats", activeChatId));
      setActiveChatId(null);
      showToast("Chat deleted");
      setShowChatMenu(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `chats/${activeChatId}`);
    }
  };

  // --- Render Helpers ---

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
          <p className="text-sm text-slate-400 font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass p-10 max-w-md w-full text-center space-y-8 border-white/10 rounded-2xl"
        >
          <div className="flex justify-center">
            <div className="p-6 bg-indigo-500/10 rounded-3xl border border-indigo-500/20">
              <MessageSquare className="w-16 h-16 text-indigo-500" />
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-4xl font-bold text-white tracking-tight">GlassChat</h1>
            <p className="text-slate-400 font-medium">Modern Real-time Messaging</p>
          </div>
          <button 
            onClick={handleGoogleLogin}
            className="w-full py-4 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-500/20 active:scale-95"
          >
            Sign in with Google
          </button>
        </motion.div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass p-8 max-w-md w-full space-y-6 border-white/10 rounded-2xl"
        >
          <div className="flex items-center gap-2 text-indigo-400 mb-4">
            <Shield className="w-5 h-5" />
            <h2 className="text-xl font-bold">Set your username</h2>
          </div>
          <div className="space-y-4">
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">@</span>
              <input 
                type="text" 
                placeholder="username" 
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                className="w-full bg-slate-900 border border-white/10 rounded-xl p-4 pl-10 text-white focus:outline-none focus:border-indigo-500 transition-all"
              />
            </div>
            <button 
              onClick={handleSetUsername}
              disabled={isLoading}
              className="w-full py-4 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-500 transition-all disabled:opacity-50"
            >
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Get Started"}
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  const activeChat = chats.find(c => c.id === activeChatId);

  return (
    <ErrorBoundary>
      <div className="h-screen flex bg-slate-950 overflow-hidden text-white selection:bg-indigo-500/30">
        
        {/* Sidebar */}
        <div className={`w-full md:w-80 lg:w-96 flex-shrink-0 flex flex-col border-r border-white/5 bg-slate-900/50 backdrop-blur-xl ${activeChatId ? 'hidden md:flex' : 'flex'}`}>
          
          {/* Sidebar Header */}
          <div className="p-6 flex items-center justify-between border-b border-white/5">
            <div className="flex items-center gap-3">
              <div className="relative group">
                <img src={profile.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${profile.username}`} className="w-12 h-12 rounded-full border-2 border-indigo-500/30 group-hover:border-indigo-500 transition-all object-cover" alt="Me" />
                <label className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-full opacity-0 group-hover:opacity-100 cursor-pointer transition-all">
                  <Camera className="w-4 h-4 text-white" />
                  <input type="file" className="hidden" accept="image/*" onChange={handleProfileUpload} />
                </label>
              </div>
              <div>
                <p className="font-bold text-sm text-white">{profile.displayName}</p>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 bg-emerald-500 rounded-full" />
                  <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Online</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setShowGroupCreate(true)} className="p-2 hover:bg-white/5 rounded-lg text-slate-400 hover:text-white transition-all">
                <PlusCircle className="w-5 h-5" />
              </button>
              <button onClick={() => signOut(auth)} className="p-2 hover:bg-red-500/10 rounded-lg text-red-400 transition-all">
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Search Bar */}
          <div className="p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input 
                type="text" 
                placeholder="Search users..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="w-full bg-slate-800/50 border border-white/5 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-all"
              />
            </div>
          </div>

          {/* Chat List */}
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {searchResults.length > 0 && (
              <div className="p-2 space-y-1 border-b border-white/5">
                <p className="px-3 text-[10px] font-bold uppercase text-indigo-400 tracking-wider mb-2">Search Results</p>
                {searchResults.map(u => (
                  <button 
                    key={u.uid}
                    onClick={() => startDM(u)}
                    className="w-full p-3 flex items-center gap-3 hover:bg-white/5 rounded-xl transition-all"
                  >
                    <img src={u.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.username}`} className="w-10 h-10 rounded-full border border-white/10" alt={u.username} />
                    <div className="text-left">
                      <p className="font-bold text-sm">{u.displayName}</p>
                      <p className="text-xs text-slate-500">@{u.username}</p>
                    </div>
                  </button>
                ))}
                <button onClick={() => setSearchResults([])} className="w-full py-2 text-[10px] text-slate-500 hover:text-white uppercase font-bold">Clear Search</button>
              </div>
            )}

            <div className="p-2 space-y-1">
              <p className="px-3 text-[10px] font-bold uppercase text-slate-500 tracking-widest my-4">Conversations</p>
              {chats.map(chat => (
                <button 
                  key={chat.id}
                  onClick={() => setActiveChatId(chat.id)}
                  className={`w-full p-3 flex items-center gap-3 rounded-xl transition-all relative group ${activeChatId === chat.id ? 'bg-indigo-500/10' : 'hover:bg-white/5'}`}
                >
                  <div className="relative">
                    {chat.type === 'dm' ? (
                      <img src={chat.otherUser?.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${chat.otherUser?.username}`} className="w-12 h-12 rounded-full border border-white/10 object-cover" alt="User" />
                    ) : (
                      <div className="w-12 h-12 bg-indigo-500/10 rounded-full flex items-center justify-center">
                        <Users className="w-6 h-6 text-indigo-500" />
                      </div>
                    )}
                    {chat.type === 'dm' && chat.otherUser?.lastSeen && Math.abs(Date.now() - chat.otherUser.lastSeen.toMillis()) < 120000 && (
                      <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-slate-900 rounded-full" />
                    )}
                  </div>
                  <div className="flex-1 text-left overflow-hidden">
                    <div className="flex justify-between items-baseline mb-0.5">
                      <p className="font-bold text-sm truncate">{chat.type === 'dm' ? chat.otherUser?.displayName : chat.name}</p>
                      <span className="text-[10px] text-slate-500">{chat.updatedAt ? new Date(chat.updatedAt.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <p className={`text-xs truncate flex-1 ${chat.unreadCount && chat.unreadCount > 0 ? 'text-white font-semibold' : 'text-slate-500'}`}>
                        {chat.lastMessage || 'No messages yet'}
                      </p>
                      {chat.unreadCount && chat.unreadCount > 0 && (
                        <div className="ml-2 bg-indigo-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                          {chat.unreadCount}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Main Chat Area */}
        <div className={`flex-1 flex flex-col bg-black/60 relative ${!activeChatId ? 'hidden md:flex' : 'flex'}`}>
          {activeChat ? (
            <>
              {/* Chat Header */}
              <div className="p-4 md:p-6 flex items-center justify-between border-b border-white/5 bg-slate-900/50 backdrop-blur-md">
                <div className="flex items-center gap-4">
                  <button onClick={() => setActiveChatId(null)} className="md:hidden p-2 hover:bg-white/5 rounded-lg text-slate-400">
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  {activeChat.type === 'dm' ? (
                    <img src={activeChat.otherUser?.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${activeChat.otherUser?.username}`} className="w-12 h-12 rounded-full border border-white/10 object-cover" alt="User" />
                  ) : (
                    <div className="w-12 h-12 bg-indigo-500/10 rounded-full flex items-center justify-center">
                      <Users className="w-6 h-6 text-indigo-500" />
                    </div>
                  )}
                  <div>
                    <p className="font-bold text-lg">{activeChat.type === 'dm' ? activeChat.otherUser?.displayName : activeChat.name}</p>
                    {activeChat.type === 'dm' && activeChat.otherUser?.lastSeen ? (
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`w-2 h-2 rounded-full ${Math.abs(Date.now() - activeChat.otherUser.lastSeen.toMillis()) < 120000 ? 'bg-emerald-500' : 'bg-slate-600'}`} />
                        <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">
                          {Math.abs(Date.now() - activeChat.otherUser.lastSeen.toMillis()) < 120000 
                            ? 'Online' 
                            : `Last seen: ${new Date(activeChat.otherUser.lastSeen.toDate()).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
                        </p>
                      </div>
                    ) : (
                      <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mt-0.5">{activeChat.type === 'group' ? 'Group Chat' : 'Direct Message'}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {activeChat.type === 'group' && activeChat.createdBy === profile.uid && (
                    <button onClick={() => setShowManageGroup(true)} className="p-2 hover:bg-white/5 rounded-lg text-slate-400 transition-all">
                      <Settings className="w-5 h-5" />
                    </button>
                  )}
                  <div className="relative">
                    <button onClick={() => setShowChatMenu(!showChatMenu)} className="p-2 hover:bg-white/5 rounded-lg text-slate-400 transition-all">
                      <MoreVertical className="w-5 h-5" />
                    </button>
                    <AnimatePresence>
                      {showChatMenu && (
                        <motion.div 
                          initial={{ opacity: 0, scale: 0.95, y: 10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95, y: 10 }}
                          className="absolute right-0 mt-2 w-48 bg-slate-800 border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden"
                        >
                          <button onClick={clearChat} className="w-full p-3 text-left text-sm hover:bg-white/5 flex items-center gap-3">
                            <Trash2 className="w-4 h-4 text-slate-400" /> Clear Chat
                          </button>
                          <button onClick={deleteChat} className="w-full p-3 text-left text-sm hover:bg-red-500/10 text-red-400 flex items-center gap-3">
                            <X className="w-4 h-4" /> Delete Chat
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4 custom-scrollbar">
                {messages.map((msg, idx) => {
                  const isMe = msg.senderId === profile.uid;
                  const showName = !isMe && activeChat.type === 'group';
                  
                  // Read receipts logic
                  const readers = Object.entries(activeChat.lastRead || {})
                    .filter(([uid, timestamp]) => uid !== msg.senderId && (timestamp as Timestamp).toMillis() >= (msg.timestamp?.toMillis() || 0))
                    .map(([uid]) => uid);

                  return (
                    <motion.div 
                      key={msg.id}
                      initial={{ opacity: 0, x: isMe ? 20 : -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                    >
                      {showName && <p className="text-[10px] font-bold text-indigo-400 mb-1 ml-1">{msg.senderName}</p>}
                      <div className={`max-w-[85%] md:max-w-[70%] p-3.5 rounded-2xl relative group ${isMe ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-slate-800 text-white rounded-tl-none'}`}>
                        <p className="text-sm leading-relaxed break-words">{msg.text}</p>
                        
                        <div className="flex items-center justify-between gap-4 mt-2 pt-2 border-t border-white/5">
                          <span className="text-[8px] font-mono text-white/20 uppercase tracking-widest">
                            {msg.timestamp ? new Date(msg.timestamp.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'SYNCING...'}
                          </span>
                          <div className="flex items-center gap-1">
                            {isMe && (
                              <div className="flex items-center gap-1.5">
                                {readers.length > 0 && (
                                  <div className="flex -space-x-1.5">
                                    {readers.slice(0, 3).map(uid => (
                                      <div key={uid} className="w-4 h-4 rounded-full border border-slate-900 bg-slate-800 flex items-center justify-center overflow-hidden" title={uid}>
                                        <UserIcon className="w-2.5 h-2.5 text-slate-400" />
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {readers.length > 0 ? (
                                  <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Check className="w-3.5 h-3.5 text-white/20" />
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Typing Indicator */}
              <AnimatePresence>
                {typingUsers.length > 0 && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="px-6 py-2 flex items-center gap-2"
                  >
                    <div className="flex gap-1">
                      <span className="w-1 h-1 bg-emerald-400 rounded-full animate-bounce" />
                      <span className="w-1 h-1 bg-emerald-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                      <span className="w-1 h-1 bg-emerald-400 rounded-full animate-bounce [animation-delay:0.4s]" />
                    </div>
                    <p className="text-[9px] font-mono text-emerald-400/60 uppercase tracking-widest">
                      {typingUsers.join(', ')} {typingUsers.length > 1 ? 'are' : 'is'} transmitting...
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Typing Indicator */}
              <AnimatePresence>
                {typingUsers.length > 0 && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="px-6 py-2 flex items-center gap-2"
                  >
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" />
                      <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                      <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.4s]" />
                    </div>
                    <p className="text-[10px] text-slate-400 font-medium italic">
                      {typingUsers.join(', ')} {typingUsers.length > 1 ? 'are' : 'is'} typing...
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Input Area */}
              <div className="p-4 md:p-6 bg-slate-900/50 border-t border-white/5 backdrop-blur-xl">
                <form onSubmit={sendMessage} className="flex gap-3 max-w-5xl mx-auto">
                  <div className="flex-1 relative">
                    <input 
                      type="text" 
                      placeholder="Type a message..." 
                      value={messageInput}
                      onChange={(e) => {
                        setMessageInput(e.target.value);
                        handleTyping();
                      }}
                      className="w-full bg-slate-800 border border-white/5 rounded-xl px-5 py-3.5 text-sm text-white focus:outline-none focus:border-indigo-500 transition-all placeholder:text-slate-500"
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                      <Activity className="w-4 h-4 text-slate-600" />
                    </div>
                  </div>
                  <button 
                    type="submit"
                    className="p-3.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-500 transition-all active:scale-95 flex items-center justify-center shadow-lg shadow-indigo-500/20"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-12 space-y-6">
              <div className="relative">
                <div className="absolute inset-0 bg-indigo-500/20 blur-3xl rounded-full animate-pulse" />
                <div className="relative p-8 bg-slate-900 border border-white/5 rounded-full">
                  <MessageSquare className="w-16 h-16 text-indigo-500/40" />
                </div>
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold">Select a chat</h2>
                <p className="text-slate-500 text-sm max-w-xs mx-auto">Find someone to chat with or create a group to get started.</p>
              </div>
              <button 
                onClick={() => setShowSearch(true)}
                className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-500/20"
              >
                Find Users
              </button>
            </div>
          )}
        </div>

        {/* Group Create Modal */}
        <AnimatePresence>
          {showGroupCreate && (
            <div className="fixed inset-0 flex items-center justify-center p-4 z-[100]">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowGroupCreate(false)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="relative glass p-8 max-w-sm w-full space-y-6 border-white/10 rounded-2xl">
                <div className="flex items-center gap-2 text-indigo-400">
                  <Users className="w-5 h-5" />
                  <h2 className="text-xl font-bold">New Group</h2>
                </div>
                <div className="space-y-4">
                  <input 
                    type="text" 
                    placeholder="Group Name" 
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    className="w-full bg-slate-900 border border-white/10 rounded-xl p-4 text-white text-sm focus:outline-none focus:border-indigo-500"
                  />
                  <button 
                    onClick={createGroup}
                    className="w-full py-4 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-500 transition-all"
                  >
                    Create Group
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Manage Group Modal */}
        <AnimatePresence>
          {showManageGroup && activeChat && (
            <div className="fixed inset-0 flex items-center justify-center p-4 z-[100]">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowManageGroup(false)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="relative glass p-8 max-w-md w-full space-y-6 border-white/10 rounded-2xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-indigo-400">
                    <Settings className="w-5 h-5" />
                    <h2 className="text-xl font-bold">Manage Group</h2>
                  </div>
                  <button onClick={() => setShowManageGroup(false)} className="p-2 hover:bg-white/10 rounded-full"><X className="w-5 h-5" /></button>
                </div>
                
                <div className="space-y-6">
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Add Member</p>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input 
                        type="text" 
                        placeholder="Search for users..." 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                        className="w-full bg-slate-900 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    {searchResults.length > 0 && (
                      <div className="mt-2 space-y-1 max-h-32 overflow-y-auto custom-scrollbar">
                        {searchResults.map(u => (
                          <div key={u.uid} className="flex items-center justify-between p-2 bg-white/5 rounded-lg border border-white/5">
                            <div className="flex items-center gap-2">
                              <img src={u.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.username}`} className="w-6 h-6 rounded-full" alt="U" />
                              <p className="text-xs font-medium">{u.displayName}</p>
                            </div>
                            {!activeChat.participants.includes(u.uid) && (
                              <button onClick={() => addMember(u)} className="p-1 hover:bg-indigo-500/20 text-indigo-400 rounded"><UserPlus className="w-4 h-4" /></button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Active Members ({groupMembers.length})</p>
                    <div className="space-y-1 max-h-48 overflow-y-auto custom-scrollbar">
                      {groupMembers.map(m => (
                        <div key={m.uid} className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                          <div className="flex items-center gap-3">
                            <img src={m.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${m.username}`} className="w-8 h-8 rounded-full object-cover" alt="M" />
                            <div>
                              <p className="text-xs font-bold">{m.displayName}</p>
                              <p className="text-[9px] text-slate-500">@{m.username}</p>
                            </div>
                          </div>
                          {m.uid !== profile.uid && (
                            <button onClick={() => removeMember(m.uid)} className="p-2 hover:bg-red-500/10 text-red-400 rounded-lg transition-all">
                              <UserMinus className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Toast */}
        <AnimatePresence>
          {toast && (
            <motion.div 
              initial={{ opacity: 0, y: 20, x: '-50%' }}
              animate={{ opacity: 1, y: 0, x: '-50%' }}
              exit={{ opacity: 0, y: 20, x: '-50%' }}
              className={`fixed bottom-8 left-1/2 px-6 py-3 glass rounded-full text-xs font-bold uppercase tracking-wider shadow-2xl z-[200] ${toast.type === 'error' ? 'border-red-500/50 text-red-400' : 'border-indigo-500/50 text-indigo-400'}`}
            >
              {toast.message}
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </ErrorBoundary>
  );
}
