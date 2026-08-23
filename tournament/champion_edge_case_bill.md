# Champion draft — The Edge-Case Bill

## Hook

The bug is rarely the dramatic outage.

It is the silent mismatch between the account, the domain, the webhook, and the thing you thought you configured.

## Body

A homepage can return 200 while the system behind it is already lying to you.

The page loads. The button is visible. The demo looks complete.

Then a real request takes a different path:

- the provider rejects the call;
- the webhook points at an older deployment;
- the sending domain is not the verified domain;
- the account has the credential, but not the permission;
- the user reaches the success screen, but no receipt exists behind it.

This is not one dramatic outage. It is an edge-case bill: small mismatches that stay invisible until someone trusts the result.

The fix is not another optimistic status check.

Before calling a system finished, run the paths that can contradict the demo:

1. Test the successful path.
2. Test the provider rejection path.
3. Read back the exact account, domain, webhook, and deployment target.
4. Confirm the user receives an honest next step.
5. Preserve the receipt so another person can inspect what happened.

Everyone thinks reliability means keeping the happy path green.

The problem is that the happy path does not tell you whether the boundaries agree.

A more useful process is simple: configure one exact target, exercise one expected failure, and read back the state from the system that owns it.

That is how you stop selling a demo and start operating a system.

## CTA

If you are shipping an agent, integration, or public funnel, take one recent “done” claim and test the branch your demo avoided. Write down what the provider, domain, webhook, and user actually returned. If they disagree, you do not have a copy problem yet. You have a receipt problem.
