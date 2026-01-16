function getContent(res) {
  const contentType = res.headers.get('content-type');
  if (contentType.startsWith('application/json')) {
    return res.json();
  }
  if (contentType.startsWith('text')) {
    return res.text();
  }
  return res.blob();
}

async function handledFetch(path, options) {
  const rawRes = await fetch(path, options);
  const content = await getContent(rawRes);
  if (rawRes.status >= 400) {
    const err = new Error('Bad response from server');
    err.status = rawRes.status;
    err.content = content;
    throw err;
  }
  return content;
}

function apiFetch(path, options = {}) {
  let qs = '';
  if (typeof options.body === 'object') {
    options.body = JSON.stringify(options.body);
  }
  if (options.query) {
    if (Object.keys(options.query).length) {
      qs = `?${new URLSearchParams(options.query).toString()}`;
    }
  }
  Object.assign(options, { credentials: 'include' });
  options.headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  return handledFetch(`${path}${qs}`, options);
}

apiFetch.post = (path, body) => {
  return apiFetch(path, { method: 'POST', body });
};

apiFetch.put = (path, body) => {
  return apiFetch(path, { method: 'PUT', body });
};

apiFetch.del = (path, body = {}) => {
  return apiFetch(path, { method: 'DELETE', body });
};

export default apiFetch;
