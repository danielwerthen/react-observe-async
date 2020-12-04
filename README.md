# React-Observe-Async!

This library is an collection of my favorite ways of dealing with asynchronous state and side effects. Observables are my preffered approach to doing just that, however, Observables and rxjs is quite complicated compared to Promises and async await functions. This library tries to bridge this gap, by providing a promise-based api that has functionality similar to observables.

## useAsync

```tsx
const { result, pending, error, refresh } = useAsync(() => {
  return fetch('https://jsonplaceholder.typicode.com/todos/');
}, []);
```

The `useAsync` hook allows you to call asynchronous closures and retrieve the output in a painless way, and at the same time reduce the number of unnecessary rerenderings. It follows the convention of the standard react hooks in terms of the second dependency array.

Whenever the dependency array is changed, the async operation will be reapplied. However, when an operation is ongoing any subsequent updates will be skipped. The last update that was skipped will be executed once the first operation is completed. Which means that the result should always be eventually consistent with the triggering state. This behavior is most likely what you want when async operation is fetching some data or the like. If you are updating data as a side effect, it would be better to use `useAsyncCallback` instead, since that unsures that all operations will be executed.

By using the `observe` function that gets passed to the hook factory function, we can get the first value in an observable and then reload the function once the observable emits another value.

```tsx
import { interval } from 'rxjs';

const refreshCycle = interval(1000);

const { result, pending, error, refresh } = useAsync(async (observe) => {
  const cycleId = await observe(refreshCycle);
  console.log(cycleId);
  return fetch('https://jsonplaceholder.typicode.com/todos/');
}, []);
```

## useAsyncCallback

```tsx
function PostEditView({ postId }) {
  const [title, setTitle] = useState();
  const [body, setBody] = useState();
  const { result, pending, error, execute } = useAsyncCallback(() => {
    return fetch(`https://jsonplaceholder.typicode.com/posts/${postId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title,
        body,
      }),
      headers: {
        'Content-type': 'application/json; charset=UTF-8',
      },
    });
  }, []);
  return <button onClick={execute}>Submit</button>;
}
```

```tsx
function PostEditView({ postId }) {
  const [title, setTitle] = useState();
  const [body, setBody] = useState();
  const { result, pending, error, execute } = useAsyncCallback(
    (title, body) => {
      return fetch(`https://jsonplaceholder.typicode.com/posts/${postId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title,
          body,
        }),
        headers: {
          'Content-type': 'application/json; charset=UTF-8',
        },
      });
    },
    []
  );
  return <button onClick={() => execute(title, body)}>Submit</button>;
}
```

Both examples above leads to the same outcome. Use whichever way fits your situation best, either passing data as arguments to `execute` or using the closure to pass the data. `execute` will always use the latest closure even though it is referentially stable.
