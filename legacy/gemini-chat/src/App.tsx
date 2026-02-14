import React, { useState, useRef, useEffect } from 'react';
import { Send, User, Bot, Loader2, Image as ImageIcon, X } from 'lucide-react';

interface ImageAttachment {
  data: string;
  mimeType: string;
}

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'agent';
  images?: ImageAttachment[];
}

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', text: 'Hello! How can I help you today?', sender: 'agent' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedImages, setSelectedImages] = useState<ImageAttachment[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const convertFileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      try {
        const newImages = await Promise.all(
          Array.from(files).map(async (file) => {
            const base64 = await convertFileToBase64(file);
            return {
              data: base64,
              mimeType: file.type
            };
          })
        );
        setSelectedImages((prev) => [...prev, ...newImages]);
      } catch (error) {
        console.error('Error converting files:', error);
      } finally {
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    }
  };

  const removeImage = (index: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
  };

  const clearImages = () => {
    setSelectedImages([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isLoading || (!input.trim() && selectedImages.length === 0)) return;

    const userMessageText = input.trim();
    const currentImages = [...selectedImages];

    const userMessage: Message = {
      id: Date.now().toString(),
      text: userMessageText,
      sender: 'user',
      images: currentImages.length > 0 ? currentImages : undefined,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    clearImages();
    setIsLoading(true);

    try {
      const payload: any = { message: userMessageText };
      if (currentImages.length > 0) {
        payload.images = currentImages.map(img => ({
          mimeType: img.mimeType,
          data: img.data
        }));
      }

      const response = await fetch('http://localhost:3000/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error('Failed to connect to local API');
      }

      const data = await response.json();
      const agentMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: data.response,
        sender: 'agent',
      };

      setMessages((prev) => [...prev, agentMessage]);
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: 'Error: Could not connect to local API. Ensure gemini-serve is running.',
        sender: 'agent',
      };
      setMessages((prev) => [...prev, errorMessage]);
      console.error('Fetch error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-gray-100">
      {/* Header */}
      <header className="flex items-center px-6 py-4 bg-gray-800 border-b border-gray-700 shadow-md">
        <Bot className="w-6 h-6 mr-2 text-blue-400" />
        <h1 className="text-xl font-bold tracking-tight">Gemini Local</h1>
      </header>

      {/* Message Feed */}
      <main className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`flex items-start max-w-[80%] space-x-2 ${
                msg.sender === 'user' ? 'flex-row-reverse space-x-reverse' : 'flex-row'
              }`}
            >
              <div
                className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                  msg.sender === 'user' ? 'bg-blue-500' : 'bg-gray-700'
                }`}
              >
                {msg.sender === 'user' ? (
                  <User className="w-5 h-5 text-white" />
                ) : (
                  <Bot className="w-5 h-5 text-blue-400" />
                )}
              </div>
              <div
                className={`p-3 rounded-lg shadow-sm ${
                  msg.sender === 'user'
                    ? 'bg-blue-600 text-white rounded-tr-none'
                    : 'bg-gray-800 text-gray-200 rounded-tl-none border border-gray-700'
                }`}
              >
                {msg.images && msg.images.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {msg.images.map((img, idx) => (
                      <img
                        key={idx}
                        src={img.data}
                        alt={`Uploaded content ${idx + 1}`}
                        className="max-w-full h-auto max-h-64 rounded-lg shadow-sm"
                      />
                    ))}
                  </div>
                )}
                <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.text}</p>
              </div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="flex items-center space-x-2 bg-gray-800 border border-gray-700 p-3 rounded-lg rounded-tl-none shadow-sm">
              <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
              <span className="text-gray-400 text-sm italic">Gemini is thinking...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* Input Area */}
      <footer className="p-4 bg-gray-800 border-t border-gray-700 shadow-lg">
        <form onSubmit={handleSendMessage} className="max-w-4xl mx-auto flex flex-col space-y-2">
          {selectedImages.length > 0 && (
            <div className="flex flex-row space-x-2 overflow-x-auto pb-2 scrollbar-hide">
              {selectedImages.map((img, index) => (
                <div key={index} className="relative flex-shrink-0">
                  <img
                    src={img.data}
                    alt={`Selected ${index}`}
                    className="h-20 w-20 object-cover rounded-lg border border-gray-600"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(index)}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600 shadow-md transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end space-x-2">
            <div className="relative flex-1">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                rows={1}
                className="w-full bg-gray-900 text-gray-100 border border-gray-700 rounded-xl px-4 py-3 pr-12 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none placeholder-gray-500"
                style={{ minHeight: '48px', maxHeight: '200px' }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute right-3 bottom-3 text-gray-400 hover:text-blue-400 transition-colors"
                title="Upload image"
              >
                <ImageIcon className="w-6 h-6" />
              </button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept="image/*"
                multiple
                className="hidden"
              />
            </div>
            <button
              type="submit"
              disabled={isLoading || (!input.trim() && selectedImages.length === 0)}
              className={`p-3 rounded-xl transition-all ${
                isLoading || (!input.trim() && selectedImages.length === 0)
                  ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-500 active:scale-95 shadow-md'
              }`}
            >
              {isLoading ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : (
                <Send className="w-6 h-6" />
              )}
            </button>
          </div>
        </form>
        <p className="text-center text-xs text-gray-500 mt-2">
          Press Enter to send, Shift+Enter for new line
        </p>
      </footer>
    </div>
  );
};

export default App;
