document.addEventListener("DOMContentLoaded", () => {

  const button = document.querySelector(".console-button");

  if (!button) return;

  button.addEventListener("click", () => {

    /*
     * Later connect this to your main
     * PrivacyVision localhost dashboard.
     */

    console.log("Opening PrivacyVision Mission Console");

    // Example:
    // chrome.tabs.create({
    //   url: "http://localhost:5173/"
    // });

  });

});