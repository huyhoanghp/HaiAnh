// Firebase Configuration for Hai Anh Study
const firebaseConfig = {
    apiKey: "AIzaSyCkLNCdbRWpWXV9vms9wmSyBT5WS3VdLdM",
    authDomain: "haianhstudy-99611.firebaseapp.com",
    projectId: "haianhstudy-99611",
    storageBucket: "haianhstudy-99611.firebasestorage.app",
    messagingSenderId: "278856696620",
    appId: "1:278856696620:web:7e8aa3fb21f952122fe289",
    measurementId: "G-7TWPWZ58R5"
};

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// Global references
window.db = firebase.firestore();
window.auth = firebase.auth();
