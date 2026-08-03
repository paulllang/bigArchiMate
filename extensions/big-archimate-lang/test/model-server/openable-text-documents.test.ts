import { beforeEach, describe, expect, test } from '@jest/globals';
import { EmptyFileSystem } from 'langium';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createServices } from '../../src/language-server/module.js';
import { LANGUAGE_CLIENT_ID, OpenableTextDocuments } from '../../src/model-server/openable-text-documents.js';

/**
 * The shared document store is where the text channel between the language client (Monaco) and the
 * server-side writers (GLSP, the model service) is arbitrated. Its rules are easy to get subtly wrong
 * and the failures are timing-dependent, so they are pinned down here rather than left to manual runs.
 */
describe('OpenableTextDocuments', () => {
   const GLSP_CLIENT_ID = 'archimate-view_0';

   let documents: OpenableTextDocuments<TextDocument>;
   let uri: string;
   let uriCounter = 0;

   /** Client ids and pending pushes are tracked per URI, so a fresh URI per test isolates state. */
   beforeEach(() => {
      documents = createServices(EmptyFileSystem).shared.workspace.TextDocuments;
      uri = `file:///test/document${uriCounter++}.view.arch`;
   });

   function open(text: string, clientId: string, version = 1): void {
      documents.notifyDidOpenTextDocument({ textDocument: { uri, languageId: 'archimate', version, text } }, clientId);
   }

   /** Full-document change, matching the sync kind the language server advertises. */
   function change(text: string, clientId: string, version: number): void {
      documents.notifyDidChangeTextDocument({ textDocument: { uri, version }, contentChanges: [{ text }] }, clientId);
   }

   function text(): string | undefined {
      return documents.get(uri)?.getText();
   }

   function version(): number | undefined {
      return documents.get(uri)?.version;
   }

   describe('staleness guard', () => {
      test('accepts a language-client edit while the shared version is far ahead', () => {
         open('original', LANGUAGE_CLIENT_ID);
         // A burst of server-authored writes, as one MCP create-nodes call produces.
         for (let serverVersion = 2; serverVersion <= 21; serverVersion++) {
            change(`server ${serverVersion}`, GLSP_CLIENT_ID, serverVersion);
         }
         expect(version()).toBe(21);

         // Monaco numbers its own buffer and has only applied a couple of coalesced pushes, so its next
         // edit declares a low version. Comparing that against the shared version would discard it.
         change('typed by the user', LANGUAGE_CLIENT_ID, 2);

         expect(text()).toBe('typed by the user');
      });

      test('ignores an edit that is stale for the client that sent it', () => {
         open('original', LANGUAGE_CLIENT_ID);
         change('first', LANGUAGE_CLIENT_ID, 2);
         change('second', LANGUAGE_CLIENT_ID, 2);

         expect(text()).toBe('first');
      });
   });

   describe('shared version', () => {
      test('is assigned by the server, not taken from the client', () => {
         open('original', LANGUAGE_CLIENT_ID);
         change('edited', LANGUAGE_CLIENT_ID, 999);

         expect(version()).toBe(2);
      });

      test('does not advance when the content is unchanged', () => {
         open('same', LANGUAGE_CLIENT_ID);
         change('same', GLSP_CLIENT_ID, 2);

         expect(version()).toBe(1);
      });
   });

   describe('echo correlation', () => {
      test('ignores the echo of a push without advancing the version', () => {
         open('original', LANGUAGE_CLIENT_ID);
         change('pushed', GLSP_CLIENT_ID, 2);
         documents.stagePushedContent(uri, 'pushed');

         change('pushed', LANGUAGE_CLIENT_ID, 2);

         expect(text()).toBe('pushed');
         expect(version()).toBe(2);
      });

      test('does not let a superseded echo overwrite newer content', () => {
         const changed: string[] = [];
         documents.onDidChangeContent(event => changed.push(event.clientId));

         open('original', LANGUAGE_CLIENT_ID);
         change('push A', GLSP_CLIENT_ID, 2);
         documents.stagePushedContent(uri, 'push A');
         change('push B', GLSP_CLIENT_ID, 3);
         documents.stagePushedContent(uri, 'push B');

         // Monaco echoes push A after the store already holds push B.
         change('push A', LANGUAGE_CLIENT_ID, 2);

         expect(text()).toBe('push B');
         expect(version()).toBe(3);
         // No rebuild for the swallowed echo: open + the two server writes only.
         expect(changed).toEqual([LANGUAGE_CLIENT_ID, GLSP_CLIENT_ID, GLSP_CLIENT_ID]);
      });

      test('leaves the version sequence intact so the next server write is accepted', () => {
         open('original', LANGUAGE_CLIENT_ID);
         change('push A', GLSP_CLIENT_ID, 2);
         documents.stagePushedContent(uri, 'push A');
         change('push A', LANGUAGE_CLIENT_ID, 2);

         // The writer derives its version from the current one. If the swallowed echo had burned a
         // version, this write would be rejected and the caller would wait for a build that never comes.
         change('next', GLSP_CLIENT_ID, 3);

         expect(text()).toBe('next');
         expect(version()).toBe(3);
      });

      test('applies a genuine edit and stops matching echoes afterwards', () => {
         open('original', LANGUAGE_CLIENT_ID);
         change('push A', GLSP_CLIENT_ID, 2);
         documents.stagePushedContent(uri, 'push A');

         // Diverges from every pushed text, so it is a real edit rather than an echo.
         change('typed by the user', LANGUAGE_CLIENT_ID, 2);
         expect(text()).toBe('typed by the user');

         // The pending queue was dropped, so text equal to the old push is now a real edit too.
         change('push A', LANGUAGE_CLIENT_ID, 3);
         expect(text()).toBe('push A');
      });

      test('only correlates echoes for the language client', () => {
         open('original', LANGUAGE_CLIENT_ID);
         documents.stagePushedContent(uri, 'pushed');

         // Another server-side writer producing the same text is a real write, not an echo of ours.
         change('pushed', GLSP_CLIENT_ID, 2);

         expect(text()).toBe('pushed');
         expect(version()).toBe(2);
      });
   });
});
