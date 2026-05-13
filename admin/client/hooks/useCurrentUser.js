import { useEffect, useState } from "react";
import axios from "axios";

let cachedUser = null;
let inflight = null;

const fetchUser = () => {
  if (inflight) return inflight;
  inflight = axios
    .get("/auth/login", { withCredentials: true })
    .then((res) => {
      const content = res.data?.content;
      if (content?.status === "logged-in") {
        cachedUser = content.user || null;
      } else {
        cachedUser = null;
      }
      return cachedUser;
    })
    .catch(() => {
      cachedUser = null;
      return null;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
};

export const clearCachedUser = () => {
  cachedUser = null;
};

const useCurrentUser = () => {
  const [user, setUser] = useState(cachedUser);
  const [loading, setLoading] = useState(cachedUser == null);

  useEffect(() => {
    let active = true;
    if (cachedUser != null) {
      setUser(cachedUser);
      setLoading(false);
      return () => {
        active = false;
      };
    }
    fetchUser().then((u) => {
      if (!active) return;
      setUser(u);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return { user, loading, role: user?.role || null };
};

export default useCurrentUser;
