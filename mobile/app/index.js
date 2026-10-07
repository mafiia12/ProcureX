import { Redirect } from 'expo-router';

import { useAuth } from '../context/AuthContext';

// Entry route: send the user to the right group for their auth state.
export default function Index() {
  const { isLoggedIn } = useAuth();
  return <Redirect href={isLoggedIn ? '/dashboard' : '/login'} />;
}
