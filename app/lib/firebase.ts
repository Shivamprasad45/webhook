// src/lib/firebase.ts
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

const firebaseConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
};

// Initialize Firebase Admin only once
if (!getApps().length) {
  initializeApp({
    credential: cert(firebaseConfig),
  });
}

const messaging = getMessaging();

export interface FCMMessage {
  title: string;
  body: string;
  token?: string;
  topic?: string;
}

export async function sendFCMNotification(
  message: FCMMessage
): Promise<boolean> {
  const isDryRun = process.env.FCM_DRY_RUN === "true";

  if (isDryRun) {
    console.log("[FCM DRY RUN]", message);
    return true;
  }

  try {
    const payload = {
      notification: {
        title: message.title,
        body: message.body,
      },
      ...(message.token
        ? { token: message.token }
        : { topic: message.topic || "orders" }),
    };

    await messaging.send(payload);
    return true;
  } catch (error) {
    console.error("FCM Error:", error);
    return false;
  }
}
