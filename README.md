# ChatApp - WhatsApp jaisa Web Chat

## Features
- Naam likh kar join; jo bhi join kare wo sab ki list mein aata hai (Online / Offline alag, search box ke saath)
- Group chat ("Everyone") + private chat, messages refresh ke baghair live
- Ticks: ✓ bheja gaya, ✓✓ pohanch gaya, neeli ✓✓ parh liya (private chat mein)
- Typing indicator, unread badge, naye message ka awaaz
- Voice message (waveform, play/seek), photo, video, documents (25 MB tak), preview + caption bhejne se pehle
- Emoji picker (categories), links clickable, copy / download / "sab ke liye delete"
- Mobile-first design, light + dark mode, phone ka back button kaam karta hai, keyboard ke saath theek chalta hai

## Folder structure
```
chat-app/
├── package.json
├── server.js
└── public/
    ├── index.html
    ├── style.css
    └── app.js
```

## Computer par chalana
1. Node.js (LTS) install karein: https://nodejs.org
2. Folder mein terminal kholein:
   ```
   npm install
   npm start
   ```
3. Browser mein http://localhost:3000 kholein. Test ke liye ek normal aur ek incognito window mein alag naam se join karein.

Voice message ke liye microphone chahiye: ye `localhost` aur `https` par chalta hai, aam `http://IP` par nahi.

## Free hosting (Render.com) - step by step
### 1) GitHub par upload
1. https://github.com par free account banayein.
2. **New repository** -> naam `chat-app` -> **Public** -> Create.
3. **uploading an existing file** par click karein, `package.json`, `server.js` aur poora `public` folder drag-drop karein (`node_modules` nahi).
4. **Commit changes**.

### 2) Render par deploy
1. https://render.com par GitHub se sign up karein.
2. **New +** -> **Web Service** -> apni `chat-app` repository chunein.
3. Settings: Runtime **Node**, Build Command `npm install`, Start Command `npm start`, Instance Type **Free**.
4. **Deploy Web Service**. 2-3 minute mein link milega (`https://chat-app-xxxx.onrender.com`).
5. Ye link doston ko bhejein. Wo browser mein kholen, naam likhein aur chat shuru. HTTPS khud lagta hai is liye voice message chalega.

Phone par "Add to Home Screen" karne se ye app jaisa khulta hai.

### Free plan ki limits
- 15 minute koi use na kare to server so jata hai; agla banda kholega to 30-60 second lagenge.
- Free plan par server restart/sleep ke baad **messages aur files delete ho jati hain** (permanent storage nahi). Aap ka naam aur login browser mein yaad rehta hai, dobara khud join ho jata hai.
- Render ki monthly hours/bandwidth limits ke liye unka pricing page dekhein, ye badalti rehti hain.

Agar messages permanent rakhne hon to database (Supabase / MongoDB Atlas free) aur file storage (Cloudinary) lagana paray ga.

## Settings (server.js ke top par)
- `MAX_FILE_MB` file ki max size, `FILE_KEEP_DAYS` files kitne din rakhni hain, `MAX_USERS` kitne log, `MAX_MESSAGES` kitne messages yaad rakhne hain
- `LOCK_NAME_TO_DEVICE = true`: ek naam sirf usi browser se use ho sakta hai jis ne pehle liya. Agar kisi ko apne naam se kisi dusre phone/laptop par bhi chat karni ho to isay `false` kar dein (phir koi bhi dusra banda wahi naam likh kar uski jagah le sakta hai).

## Dhyan rakhein
- Is app mein password nahi hai (aap ki marzi), is liye link sirf apne logon ko dein.
- Messages server ki memory mein hote hain, server band hone par chale jate hain.
