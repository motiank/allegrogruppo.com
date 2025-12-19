#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USERS_FILE = path.resolve(__dirname, '../users.json');

// Helper function to generate authKey (same as in auth/index.js)
function getUserKey(email, password) {
  const base_string = email + "mtsecretcode2015" + password;
  const shasum = crypto.createHash('md5');
  shasum.update(base_string, 'ascii');
  return shasum.digest('hex');
}

// Read users from file
function readUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) {
      return [];
    }
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading users file:', error.message);
    process.exit(1);
  }
}

// Write users to file
function writeUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
    console.log('Users file updated successfully');
  } catch (error) {
    console.error('Error writing users file:', error.message);
    process.exit(1);
  }
}

// Add a new user
function addUser(email, password, role = 'admin') {
  const users = readUsers();
  
  // Check if user already exists
  const existingUser = users.find(u => u.email === email);
  if (existingUser) {
    console.error(`Error: User with email "${email}" already exists`);
    process.exit(1);
  }

  // Generate user_id
  const maxId = users.reduce((max, u) => {
    const id = u.user_id || u.id || 0;
    return id > max ? id : max;
  }, 0);
  const user_id = maxId + 1;

  // Create new user
  const newUser = {
    user_id: user_id,
    id: user_id,
    email: email,
    password: password,
    authKey: getUserKey(email, password),
    role: role,
    status: 'active'
  };

  users.push(newUser);
  writeUsers(users);
  console.log(`User added successfully:`);
  console.log(`  ID: ${user_id}`);
  console.log(`  Email: ${email}`);
  console.log(`  Role: ${role}`);
}

// Update an existing user
function updateUser(email, password = null, role = null) {
  const users = readUsers();
  
  const userIndex = users.findIndex(u => u.email === email);
  if (userIndex === -1) {
    console.error(`Error: User with email "${email}" not found`);
    process.exit(1);
  }

  const user = users[userIndex];
  
  // Update password if provided
  if (password) {
    user.password = password;
    user.authKey = getUserKey(email, password);
  }

  // Update role if provided
  if (role) {
    user.role = role;
  }

  users[userIndex] = user;
  writeUsers(users);
  console.log(`User updated successfully:`);
  console.log(`  Email: ${email}`);
  if (password) {
    console.log(`  Password: updated`);
  }
  if (role) {
    console.log(`  Role: ${role}`);
  }
}

// Remove a user
function removeUser(email) {
  const users = readUsers();
  
  const userIndex = users.findIndex(u => u.email === email);
  if (userIndex === -1) {
    console.error(`Error: User with email "${email}" not found`);
    process.exit(1);
  }

  const user = users[userIndex];
  users.splice(userIndex, 1);
  writeUsers(users);
  console.log(`User removed successfully:`);
  console.log(`  Email: ${email}`);
  console.log(`  ID: ${user.user_id || user.id}`);
}

// List all users
function listUsers() {
  const users = readUsers();
  
  if (users.length === 0) {
    console.log('No users found');
    return;
  }

  console.log(`Found ${users.length} user(s):\n`);
  users.forEach((user, index) => {
    console.log(`${index + 1}. Email: ${user.email}`);
    console.log(`   ID: ${user.user_id || user.id}`);
    console.log(`   Role: ${user.role || 'N/A'}`);
    console.log(`   Status: ${user.status || 'N/A'}`);
    console.log('');
  });
}

// Show usage information
function showUsage() {
  console.log('Usage: node scripts/users.js <command> [options]');
  console.log('');
  console.log('Commands:');
  console.log('  add <email> <password> [role]    Add a new user');
  console.log('  update <email> [password] [role]  Update an existing user');
  console.log('  remove <email>                    Remove a user');
  console.log('  list                              List all users');
  console.log('');
  console.log('Examples:');
  console.log('  node scripts/users.js add admin@example.com mypassword123');
  console.log('  node scripts/users.js add user@example.com pass123 user');
  console.log('  node scripts/users.js update admin@example.com newpassword');
  console.log('  node scripts/users.js update admin@example.com newpassword admin');
  console.log('  node scripts/users.js remove admin@example.com');
  console.log('  node scripts/users.js list');
}

// Main function
function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    showUsage();
    process.exit(1);
  }

  const command = args[0].toLowerCase();

  switch (command) {
    case 'add':
      if (args.length < 3) {
        console.error('Error: add command requires email and password');
        console.error('Usage: node scripts/users.js add <email> <password> [role]');
        process.exit(1);
      }
      addUser(args[1], args[2], args[3] || 'admin');
      break;

    case 'update':
      if (args.length < 2) {
        console.error('Error: update command requires email');
        console.error('Usage: node scripts/users.js update <email> [password] [role]');
        process.exit(1);
      }
      updateUser(args[1], args[2] || null, args[3] || null);
      break;

    case 'remove':
      if (args.length < 2) {
        console.error('Error: remove command requires email');
        console.error('Usage: node scripts/users.js remove <email>');
        process.exit(1);
      }
      removeUser(args[1]);
      break;

    case 'list':
      listUsers();
      break;

    default:
      console.error(`Error: Unknown command "${command}"`);
      showUsage();
      process.exit(1);
  }
}

// Run the script
main();







