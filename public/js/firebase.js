// Firebase 연결
// - 설정값은 firebase-config.js
// - 개발·테스트: 주소에 ?emulator=localhost:8080 을 붙이면 Firestore 에뮬레이터에 연결

const SDK_VERSION = '10.14.1';
const SDK = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;

export async function connect() {
  const params = new URLSearchParams(location.search);
  const emulator = params.get('emulator');
  const { firebaseConfig, ROOM } = await import('./firebase-config.js');
  const config = emulator ? { projectId: 'demo-classroom', apiKey: 'demo' } : firebaseConfig;
  const room = (params.get('room') || ROOM || 'main').replace(/[^\w가-힣-]/g, '').slice(0, 40) || 'main';
  if (!config.projectId || !config.apiKey) return { configured: false };

  const [appMod, fs] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const app = appMod.initializeApp(config);

  let db;
  try {
    // 기기에 기록을 남겨 두면 인터넷이 잠깐 끊겨도 체크가 저장됐다가 연결되면 올라간다
    db = fs.initializeFirestore(app, {
      localCache: emulator
        ? fs.memoryLocalCache()
        : fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    });
  } catch {
    db = fs.getFirestore(app);
  }
  if (emulator) {
    const [host, port] = emulator.split(':');
    fs.connectFirestoreEmulator(db, host, Number(port));
  }
  return { configured: true, fs, db, room, emulator: Boolean(emulator), projectId: config.projectId };
}
