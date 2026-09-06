(function () {
  window.addEventListener('message', event => {
    if (event.data?.type === 'setCommentsVisible') {
      document.body.classList.toggle('comments-visible', event.data.visible === true);
    }
  });
}());
