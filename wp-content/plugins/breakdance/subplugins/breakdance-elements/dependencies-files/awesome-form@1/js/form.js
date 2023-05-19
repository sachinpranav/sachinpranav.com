/* global grecaptcha */
(function () {
  const loadingClass = "is-loading";

  function formatError(error) {
    if (Array.isArray(error) && error.length) {
      return error.map((e) => e.message).join("<br />");
    }

    if (typeof error === "object") return error.message;
  }

  function interceptResponse(response) {
    return response.json().then((body) => {
      if (!response.ok) {
        throw new Error(formatError(body.data));
      }

      return body;
    });
  }

  function postData(url, data) {
    const { makeAjaxRequest } = window.BreakdanceFrontend.utils;
    const payload = {
      method: "POST",
      credentials: "same-origin", // Needed in order to store cookies.
      body: data,
    };

    return makeAjaxRequest(url, payload).then(interceptResponse);
  }

  function createMessage(text, type = "success", onDismiss = null) {
    const node = document.createElement("div");
    node.innerHTML = text;
    node.classList.add("breakdance-form-message");
    node.classList.add("breakdance-form-message--" + type);

    if (typeof onDismiss === "function") {
      node.classList.add("breakdance-form-message-dismissable");

      const dismissWrapper = document.createElement("div");
      dismissWrapper.classList.add("breakdance-form-message-dismiss");

      const dismissButton = document.createElement("button");
      dismissButton.classList.add("breakdance-form-message-dismiss-button");
      dismissButton.innerHTML = "&times;";
      dismissButton.addEventListener("click", onDismiss);

      dismissWrapper.appendChild(dismissButton);
      node.appendChild(dismissWrapper);
    }

    return node;
  }

  function createErrorMessage(text) {
    return createMessage(text, "error");
  }

  function resetForm(form) {
    form.reset();

    const uploads = form.querySelector(".breakdance-form-file-upload-list");
    if (uploads) uploads.remove();

    const fileText = form.querySelector(".breakdance-form-file-upload__text");
    if (fileText) fileText.textContent = "No file chosen";

    resetConditionalFields(form);
    if (form.dataset.steps >= 1) resetSteps(form);
  }

  function safeEval(code) {
    try {
      eval(code);
    } catch (e) {
      console.debug("Could not run Custom JavaScript.");
    }
  }

  function getRecaptchaToken(apiKey) {
    const payload = { action: "breakdance_submit" };

    return new Promise((resolve, reject) => {
      grecaptcha.ready(() => {
        try {
          const token = grecaptcha.execute(apiKey, payload);
          return resolve(token);
        } catch (error) {
          return reject(error);
        }
      });
    });
  }

  function getOptions(form) {
    const options = JSON.parse(form.getAttribute("data-options"));

    const defaultOptions = {
      name: "empty",
      ajaxUrl: null,
      successMessage: null,
      errorMessage: null,
      clearOnSuccess: true,
      hideOnSuccess: false,
      redirectUrl: null,
      customJavaScript: {},
      popupsOnSuccess: [],
      popupsOnError: [],
      recaptcha: {
        key: null,
        enabled: false,
      },
    };

    if (!options) {
      return defaultOptions;
    }

    return Object.assign({}, defaultOptions, options);
  }

  async function onSubmit(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const loading = form.classList.contains(loadingClass);
    const options = getOptions(form);

    if (loading) return;

    const body = new FormData(form);
    body.append("action", `breakdance_form_${options.slug}`);

    beforeSubmit(form);

    if (options.recaptcha.enabled) {
      try {
        const token = await getRecaptchaToken(options.recaptcha.key);
        body.append("recaptcha_token", token);
      } catch (error) {
        console.error(error);
      }
    }

    postData(options.ajaxUrl, body)
      .then((response) => onRequestSuccess(response, form))
      .catch((error) => onRequestError(error, form))
      .finally(() => afterSubmit(form));
  }

  function beforeSubmit(form) {
    form.classList.add(loadingClass);

    const msg = form.parentElement.querySelector(".breakdance-form-message");
    if (msg) msg.remove();
  }

  function afterSubmit(form) {
    form.classList.remove(loadingClass);
  }

  function onRequestError(error, form) {
    console.debug("[BREAKDANCE] Received a form error:", error.message);

    const options = getOptions(form);
    const message =
      error.message || options.errorMessage || "An unexpected error occurred.";
    const errorNode = createErrorMessage(message);
    form.after(errorNode);

    if (options.popupsOnError.length > 0) {
      options.popupsOnError.forEach((errorPopup) => {
        if (errorPopup.popup && errorPopup.action) {
          BreakdancePopup.runAction(errorPopup.popup, errorPopup.action);
        }
      });
    }

    safeEval(options.customJavaScript?.js_on_error);
  }

  function onRequestSuccess(response, form) {
    console.debug("[BREAKDANCE] Received form response:", response);

    const options = getOptions(form);
    const redirectOnSuccess = options.redirect && options.redirectUrl;

    if (options.successMessage && !redirectOnSuccess) {
      let messageNode = createMessage(options.successMessage);

      if (options.hideOnSuccess) {
        form.classList.add("breakdance-form--hidden");
        messageNode = createMessage(options.successMessage, "success", () => {
          form.classList.remove("breakdance-form--hidden");
          messageNode.remove();
        });
      }

      form.after(messageNode);
    }

    if (options.clearOnSuccess) {
      resetForm(form);
    }

    if (options.popupsOnSuccess.length > 0) {
      options.popupsOnSuccess.forEach((successPopup) => {
        if (successPopup.popup && successPopup.action) {
          BreakdancePopup.runAction(successPopup.popup, successPopup.action);
        }
      });
    }

    if (redirectOnSuccess) {
      location.href = options.redirectUrl;
    }

    safeEval(options.customJavaScript?.js_on_success);
  }

  function onInputUpdate(event) {
    const parent = event.currentTarget.closest(".breakdance-form-field");
    const activeClass = "breakdance-form-field--filled";

    if (!parent) return;

    if (event.currentTarget.value.length) {
      parent.classList.add(activeClass);
    } else {
      parent.classList.remove(activeClass);
    }
  }

  function onFileInputChange(event) {
    const input = event.currentTarget;

    if (!input.files.length) {
      return;
    }

    const files = Array.from(input.files);
    const names = files.map((f) => f.name);

    // Default Input
    const textNode = input.parentElement.querySelector(
      ".breakdance-form-file-upload__text"
    );

    if (textNode) {
      textNode.innerHTML = names.join(", ");
    }

    // Drag and Drop
    const sibling = input.parentElement.nextElementSibling;

    if (!sibling) {
      return;
    }

    const listNode = sibling.querySelector(
      ".breakdance-form-file-upload-list-files"
    );

    if (listNode) {
      listNode.innerHTML = names.map((n) => `<li>${n}</li>`).join("");
      listNode.parentElement.classList.add("is-files-visible");
    }
  }

  function bindEvents(form) {
    bindFileEvents(form);

    const inputs = Array.from(form.querySelectorAll("input, select, textarea"));

    inputs.forEach((input) => {
      input.addEventListener("input", onInputUpdate);
    });

    form.addEventListener("submit", onSubmit);
  }

  function bindDropzone(dropzone) {
    // TODO: Refactor these functions
    const dragOver = (event) => {
      event.preventDefault();
      event.stopPropagation();
      dropzone.classList.add("is-dragging");
    };

    const dragLeave = (event) => {
      event.preventDefault();
      event.stopPropagation();
      dropzone.classList.remove("is-dragging");
    };

    const drop = (event) => {
      event.preventDefault();
      event.stopPropagation();

      const fileInput = dropzone.querySelector('input[type="file"]');

      if (fileInput) {
        fileInput.files = event.dataTransfer.files;

        // Trigger change event.
        // TODO: Is this the best way of doing it?
        //  Check if it works in all major browsers.
        const syntheticEvent = document.createEvent("UIEvents");
        syntheticEvent.initUIEvent("change", true, true);
        fileInput.dispatchEvent(syntheticEvent);
      }
    };

    dropzone.addEventListener("dragover", dragOver);
    dropzone.addEventListener("dragenter", dragOver);

    dropzone.addEventListener("dragleave", dragLeave);
    dropzone.addEventListener("dragend", dragLeave);
    dropzone.addEventListener("drop", dragLeave);

    dropzone.addEventListener("drop", drop);
  }

  function bindFileEvents(form) {
    const dropZones = Array.from(
      form.querySelectorAll(".breakdance-form-file-upload--draggable")
    );
    const inputs = Array.from(
      form.querySelectorAll(".breakdance-form-file-upload__input")
    );

    inputs.forEach((input) =>
      input.addEventListener("change", onFileInputChange)
    );
    dropZones.forEach((dropzone) => bindDropzone(dropzone));
  }

  function unbindEvents(form) {
    const inputs = Array.from(form.querySelectorAll("input, select, textarea"));

    inputs.forEach((input) => {
      input.removeEventListener("input", onInputUpdate);
    });

    form.removeEventListener("submit", onSubmit);
  }

  function initConditionalFields(form, attachEventListeners = false) {
    const inputs = Array.from(form.querySelectorAll("input, select, textarea"));

    inputs.forEach((input) => {
      const { conditionalFieldId, conditionalValue, conditionalOperand } =
        input.dataset;
      if (!conditionalFieldId) {
        return;
      }
      const conditionalFields = form.querySelectorAll(
        `[name="fields[${conditionalFieldId}]"],[name="fields[${conditionalFieldId}][]"]`
      );
      const wrapper = input.closest(".breakdance-form-field");

      // Show or hide conditional field on change
      conditionalFields.forEach((conditionalField) => {
        if (attachEventListeners) {
          const isSelectOrRadioField = conditionalField.matches(
            "input[type=radio], input[type=checkbox], input[type=file], select"
          );
          if (isSelectOrRadioField) {
            conditionalField.addEventListener("change", () => {
              showOrHideConditionalField(
                form,
                input,
                wrapper,
                conditionalFieldId,
                conditionalValue,
                conditionalOperand
              );
            });
          } else {
            conditionalField.addEventListener("keyup", () => {
              showOrHideConditionalField(
                form,
                input,
                wrapper,
                conditionalFieldId,
                conditionalValue,
                conditionalOperand
              );
            });
          }
        }
        // also run on init to set the initial state
        showOrHideConditionalField(
          form,
          input,
          wrapper,
          conditionalFieldId,
          conditionalValue,
          conditionalOperand
        );
      });
    });
  }

  function showOrHideConditionalField(
    form,
    inputElement,
    fieldElement,
    conditionalFieldId,
    conditionalValue,
    conditionalOperand
  ) {
    const fieldValue = getConditionalFieldValue(form, conditionalFieldId);
    if (shouldShowField(fieldValue, conditionalOperand, conditionalValue)) {
      inputElement.removeAttribute("disabled");
      return fieldElement.classList.remove("breakdance-form-field--hidden");
    }

    inputElement.disabled = true;
    return fieldElement.classList.add("breakdance-form-field--hidden");
  }

  function getConditionalFieldValue(form, conditionalFieldId) {
    const conditionalField = form.querySelector(
      `[name="fields[${conditionalFieldId}]"],[name="fields[${conditionalFieldId}][]"]:checked, [type='file'][name="fields[${conditionalFieldId}][]"]`
    );
    if (conditionalField === null) {
      return null;
    }

    if (conditionalField.type === "checkbox" && !conditionalField.checked) {
      return null;
    }

    if (conditionalField.value) {
      return conditionalField.value;
    }

    return null;
  }

  function resetConditionalFields(form) {
    initConditionalFields(form, false);
  }

  /**
   * The below is replicated in PHP in forms/custom/custom.php
   * so if you change it here, you need to change it there too.
   */
  function shouldShowField(aValue, operand, bValue) {
    if (operand === "equals") {
      return aValue == bValue;
    } else if (operand === "not equals") {
      return aValue != bValue;
    } else if (operand === "is set") {
      return aValue;
    } else if (operand === "is not set") {
      return !aValue;
    } else if (operand === "is one of") {
      const bValueArray = bValue.split(",");
      return bValueArray.some((x) => x.trim() == aValue);
    } else if (operand === "is none of") {
      const bValueArray = bValue.split(",");
      return !bValueArray.some((x) => x.trim() == aValue);
    } else if (operand === "contains") {
      if (typeof aValue === "string" && typeof bValue === "string") {
        return aValue.toLowerCase().includes(bValue.toLowerCase());
      }
      return false;
    } else if (operand === "does not contain") {
      if (typeof aValue === "string" && typeof bValue === "string") {
        return !aValue.toLowerCase().includes(bValue.toLowerCase());
      }
      return true;
    } else if (operand === "is before date") {
      if (aValue === null || bValue === null) {
        return false;
      }
      const aDateValue = new Date(aValue);
      const bDateValue = new Date(bValue);
      const aValueIsValidDate =
        aDateValue instanceof Date && isFinite(aDateValue);
      const bValueIsValidDate =
        bDateValue instanceof Date && isFinite(bDateValue);
      if (!aValueIsValidDate || !bValueIsValidDate) {
        return false;
      }
      return aDateValue < bDateValue;
    } else if (operand === "is after date") {
      if (aValue === null || bValue === null) {
        return false;
      }
      const aDateValue = new Date(aValue);
      const bDateValue = new Date(bValue);
      const aValueIsValidDate =
        aDateValue instanceof Date && isFinite(aDateValue);
      const bValueIsValidDate =
        bDateValue instanceof Date && isFinite(bDateValue);
      if (!aValueIsValidDate || !bValueIsValidDate) {
        return false;
      }
      return aDateValue > bDateValue;
    } else if (operand === "is before time") {
      if (aValue === null || bValue === null) {
        return false;
      }
      const todaysDate = new Date().toDateString();
      const aDateValue = new Date(`${todaysDate} ${aValue}`);
      const bDateValue = new Date(`${todaysDate} ${bValue}`);
      const aValueIsValidDate =
        aDateValue instanceof Date && isFinite(aDateValue);
      const bValueIsValidDate =
        bDateValue instanceof Date && isFinite(bDateValue);
      if (!aValueIsValidDate || !bValueIsValidDate) {
        return false;
      }
      return aDateValue < bDateValue;
    } else if (operand === "is after time") {
      if (aValue === null || bValue === null) {
        return false;
      }
      const todaysDate = new Date().toDateString();
      const aDateValue = new Date(`${todaysDate} ${aValue}`);
      const bDateValue = new Date(`${todaysDate} ${bValue}`);
      const aValueIsValidDate =
        aDateValue instanceof Date && isFinite(aDateValue);
      const bValueIsValidDate =
        bDateValue instanceof Date && isFinite(bDateValue);
      if (!aValueIsValidDate || !bValueIsValidDate) {
        return false;
      }
      return aDateValue > bDateValue;
    }
    return true;
  }

  function destroy(selector) {
    const form = document.querySelector(selector);

    if (!form) {
      console.warn("[BREAKDANCE] Could not find form to destroy:", selector);
      return;
    }

    unbindEvents(form);
  }

  function initSteps(form, isBuilder = false) {
    if (form.dataset.steps == 0) return;

    const nextStepButtons = form.querySelectorAll(
      ".breakdance-form-button__next-step"
    );

    nextStepButtons.forEach((button) =>
      button.addEventListener("click", () => {
        nextStep(form, isBuilder);
      })
    );

    const previousStepButtons = form.querySelectorAll(
      ".breakdance-form-button__previous-step"
    );

    previousStepButtons.forEach((button) =>
      button.addEventListener("click", () => {
        previousStep(form);
      })
    );

    showOrHideSteps(form);
  }

  function validateStep(form, step) {
    const inputs = Array.from(
      form.querySelectorAll(
        `[data-form-step='${step}'] input,[data-form-step='${step}'] select, [data-form-step='${step}'] textarea`
      )
    );
    return inputs.every((input) => {
      input.reportValidity();
      return input.checkValidity();
    });
  }

  function nextStep(form, isBuilder) {
    const currentStep = parseInt(form.dataset.currentStep);
    if (!validateStep(form, currentStep) && !isBuilder) {
      return;
    }
    setStep(form, currentStep + 1);
  }

  function previousStep(form) {
    const currentStep = parseInt(form.dataset.currentStep);
    setStep(form, currentStep - 1);
  }

  function setStep(form, step) {
    form.dataset.currentStep = step.toString();
    showOrHideSteps(form);
  }

  function showOrHideSteps(form) {
    const currentStep = parseInt(form.dataset.currentStep);
    const totalSteps = parseInt(form.dataset.steps);
    const fields = form.querySelectorAll(
      ".breakdance-form-field:not(.breakdance-form-footer)"
    );

    fields.forEach((field) => {
      const formStep = parseInt(field.dataset.formStep);
      if (formStep === currentStep) {
        field.classList.remove("hidden-step");
      } else {
        field.classList.add("hidden-step");
      }
    });

    const submitButton = form.querySelector(".breakdance-form-button__submit");
    const nextStepButton = form.querySelector(
      `.breakdance-form-field[data-form-step="${currentStep}"] .breakdance-form-button__next-step`
    );
    const previousStepButton = form.querySelector(
      `.breakdance-form-field[data-form-step="${currentStep}"] .breakdance-form-button__previous-step`
    );
    if (currentStep === totalSteps) {
      submitButton.classList.remove("hidden");
      nextStepButton.classList.add("hidden");
    } else {
      submitButton.classList.add("hidden");
      nextStepButton.classList.remove("hidden");
    }
    if (currentStep > 1) {
      previousStepButton.classList.remove("hidden");
    } else {
      previousStepButton.classList.add("hidden");
    }

    const steps = form.querySelectorAll(".breakdance-form-stepper__step");

    if (steps) {
      steps.forEach((step) => {
        const stepperStep = parseInt(step.dataset.stepperStep);
        if (stepperStep <= currentStep) {
          step.classList.add("is-active");
        } else {
          step.classList.remove("is-active");
        }
      });
      const currentStepper = form.querySelector(
        `[data-stepper-step="${currentStep}"]`
      );
      if (currentStepper) {
        currentStepper.classList.add("is-active");
      }
    }
  }

  function resetSteps(form) {
    setStep(form, 1);
  }

  function init(selector) {
    const form = document.querySelector(selector);

    if (!form) {
      console.warn("[BREAKDANCE] Could not find form:", selector);
      return;
    }

    bindEvents(form);
    initConditionalFields(form, true);
    initSteps(form);
  }

  window.breakdanceForm = {
    init,
    destroy,
    initConditionalFields,
    initSteps,
  };
})();
