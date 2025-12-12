import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USERS_FILE = path.resolve(__dirname, '../../../users.json');

class Users {
  constructor() {
    this.usersFile = USERS_FILE;
    this.ensureUsersFile();
  }

  ensureUsersFile() {
    if (!fs.existsSync(this.usersFile)) {
      fs.writeFileSync(this.usersFile, JSON.stringify([], null, 2), 'utf8');
    }
  }

  readUsers() {
    try {
      const data = fs.readFileSync(this.usersFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error reading users file:', error);
      return [];
    }
  }

  writeUsers(users) {
    try {
      fs.writeFileSync(this.usersFile, JSON.stringify(users, null, 2), 'utf8');
    } catch (error) {
      console.error('Error writing users file:', error);
      throw error;
    }
  }

  // Expected interface: get(query, callback)
  // query: { user_id: id } or { email: email } or { id: id }
  // callback: function(db_res) where db_res has getRes() method
  get(query, callback) {
    const users = this.readUsers();
    let results = users;

    // Filter by query
    if (query.user_id !== undefined) {
      results = users.filter(u => u.user_id === query.user_id || u.id === query.user_id);
    } else if (query.email !== undefined) {
      results = users.filter(u => u.email === query.email);
    } else if (query.id !== undefined) {
      results = users.filter(u => u.id === query.id || u.user_id === query.id);
    }

    // Create a response object that matches the expected interface
    const db_res = {
      getRes: () => ({
        meta: {
          err: results.length === 0 ? 'User not found' : null,
          resType: 'content'
        },
        rows: results
      })
    };

    callback(db_res);
  }

  // Expected interface: update(user, callback)
  // user: user object to update or create
  // callback: function(err, tpl) where err is error and tpl is the result
  update(user, callback) {
    const users = this.readUsers();
    let updated = false;
    let userIndex = -1;

    // Find existing user by user_id or id
    if (user.user_id !== undefined) {
      userIndex = users.findIndex(u => u.user_id === user.user_id || u.id === user.user_id);
    } else if (user.id !== undefined) {
      userIndex = users.findIndex(u => u.id === user.id || u.user_id === user.id);
    } else if (user.email !== undefined) {
      userIndex = users.findIndex(u => u.email === user.email);
    }

    try {
      if (userIndex >= 0) {
        // Update existing user
        users[userIndex] = { ...users[userIndex], ...user };
        updated = true;
      } else {
        // Create new user
        if (!user.user_id && !user.id) {
          // Generate a new user_id if not provided
          const maxId = users.reduce((max, u) => {
            const id = u.user_id || u.id || 0;
            return id > max ? id : max;
          }, 0);
          user.user_id = maxId + 1;
          user.id = user.user_id;
        }
        users.push(user);
        updated = true;
      }

      this.writeUsers(users);
      
      // Return in expected format
      const db_res = {
        getRes: () => ({
          meta: {
            err: null,
            resType: 'content'
          },
          rows: [userIndex >= 0 ? users[userIndex] : user]
        })
      };

      callback(null, db_res);
    } catch (error) {
      console.error('Error updating user:', error);
      callback(error, null);
    }
  }
}

// Export singleton instance
const users = new Users();
export default users;





