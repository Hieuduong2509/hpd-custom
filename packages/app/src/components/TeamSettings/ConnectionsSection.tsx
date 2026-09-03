import { useState } from 'react';
import { Box, Button, Card, Divider, Flex, Stack, Text } from '@mantine/core';
import { IconPencil, IconX } from '@tabler/icons-react';

import api from '@/api';
import { ConnectionForm } from '@/components/ConnectionForm';
import { IS_CLICKHOUSE_BUILD, IS_LOCAL_MODE } from '@/config';
import { useConnections } from '@/connection';

export default function ConnectionsSection() {
  const { data: connections } = useConnections();
  const { data: me } = api.useMe();
  // Only admins may create/edit/delete Connections — dev/owner can view
  // and use them (e.g. for querying) but the write routes are blocked
  // server-side (requireRole('admin') in routers/api/connections.ts), so
  // this hides controls that would otherwise 403.
  const isAdmin = me?.role === 'admin';
  const [editedConnectionId, setEditedConnectionId] = useState<string | null>(
    null,
  );
  const [isCreatingConnection, setIsCreatingConnection] = useState(false);

  return (
    <Box id="connections" data-testid="connections-section">
      <Text size="md">Connections</Text>
      <Divider my="md" />
      <Card>
        <Stack mb="md">
          {connections?.map(connection => (
            <Box key={connection.id}>
              <Flex justify="space-between" align="flex-start">
                <Stack gap="xs">
                  <Text fw={500} size="lg">
                    {connection.name}
                  </Text>
                  <Text size="sm" c="dimmed">
                    <b>Host:</b> {connection.host}
                  </Text>
                  <Text size="sm" c="dimmed">
                    <b>Username:</b> {connection.username}
                  </Text>
                  <Text size="sm" c="dimmed">
                    <b>Password:</b> [Configured]
                  </Text>
                </Stack>
                {!isAdmin ? null : editedConnectionId !== connection.id ? (
                  <Button
                    variant="subtle"
                    onClick={() => setEditedConnectionId(connection.id)}
                    size="sm"
                  >
                    <IconPencil size={14} className="me-2" /> Edit
                  </Button>
                ) : (
                  <Button
                    variant="subtle"
                    onClick={() => setEditedConnectionId(null)}
                    size="sm"
                  >
                    <IconX size={14} className="me-2" /> Cancel
                  </Button>
                )}
              </Flex>
              {editedConnectionId === connection.id && (
                <ConnectionForm
                  connection={connection}
                  isNew={false}
                  onSave={() => {
                    setEditedConnectionId(null);
                  }}
                  showCancelButton={false}
                  showDeleteButton
                />
              )}
              <Divider my="md" />
            </Box>
          ))}
        </Stack>
        {isAdmin &&
          !isCreatingConnection &&
          (IS_LOCAL_MODE ? (connections?.length ?? 0) < 1 : true) && (
            <Button
              data-testid="add-connection-button"
              variant="primary"
              onClick={() => setIsCreatingConnection(true)}
            >
              Add Connection
            </Button>
          )}
        {isAdmin && isCreatingConnection && (
          <Stack gap="md">
            <ConnectionForm
              connection={{
                id: 'new',
                name: 'My New Connection',
                host: IS_CLICKHOUSE_BUILD
                  ? window.location.origin
                  : 'http://localhost:8123',
                username: 'default',
                password: '',
              }}
              isNew={true}
              onSave={() => setIsCreatingConnection(false)}
              onClose={() => setIsCreatingConnection(false)}
              showCancelButton
            />
          </Stack>
        )}
      </Card>
    </Box>
  );
}
